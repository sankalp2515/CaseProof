"""Firestore-native case revisions, audit and atomic work publication."""

import json
import time
import uuid
from contextlib import contextmanager
from contextvars import ContextVar

from caseproof.adapters.sqlite_casestore import OPERATIONAL_METADATA, ConflictError
from caseproof.domain.contracts import Approval, CaseSnapshot, canonical, hash_json, now

PROCESS_EVENTS = {
    "artifact_added",
    "claim_corrected",
    "request_unavailable",
    "request_fulfilled",
    "victim_payment_decision",
    "feed_update_received",
    "bank_feed_received",
    "local_replay_clock",
    "clock_changed",
}


TENANT_CASE_LIMIT = 25


class CaseLimitError(RuntimeError):
    """A demo complaint limit was reached; carries a user-facing code."""


def identity(*parts):
    return hash_json(list(parts))


class FirestoreCaseStore:
    cloud = True

    def __init__(self, documents, max_cases=80):
        self.documents = documents
        self.max_cases = max_cases
        self.execution = ContextVar("caseproof_execution_" + uuid.uuid4().hex, default=None)

    @contextmanager
    def worker_fence(self, job):
        token = self.execution.set((job["job_id"], job["lease_token"]))
        try:
            yield
        finally:
            self.execution.reset(token)

    def case_path(self, cid):
        return "cases/" + identity(cid)

    def revision_path(self, cid, revision):
        return "revisions/" + identity(cid, revision)

    def create(self, case_id=None, tenant_id="demo", **meta):
        if set(meta) - OPERATIONAL_METADATA:
            raise ValueError("non-operational metadata forbidden")
        cid = case_id or "CASE-" + uuid.uuid4().hex[:10]
        snapshot = CaseSnapshot(case_id=cid, revision=1).seal()

        def commit(tx):
            if tx.get(self.case_path(cid)):
                raise ConflictError("case_already_exists")
            # Daily across all visitors, plus a per-practice-session share, so the demo
            # never runs out permanently and one visitor cannot use everyone's budget.
            from datetime import datetime, timezone

            day = datetime.now(timezone.utc).date().isoformat()
            daily_path, tenant_path = (
                "demo_limits/cases-" + day,
                "demo_limits/tenant-cases-" + identity(tenant_id),
            )
            daily = tx.get(daily_path) or {"count": 0}
            mine = tx.get(tenant_path) or {"count": 0}
            if daily["count"] >= self.max_cases:
                raise CaseLimitError("daily_case_limit")
            if mine["count"] >= TENANT_CASE_LIMIT:
                raise CaseLimitError("session_case_limit")
            daily["count"] += 1
            mine["count"] += 1
            tx.set(daily_path, daily)
            tx.set(tenant_path, mine)
            tx.set(
                self.case_path(cid),
                {
                    "case_id": cid,
                    "tenant_id": tenant_id,
                    "metadata": meta,
                    "revision": 1,
                    "digest": snapshot.digest,
                    "decisions": {},
                },
                create=True,
            )
            tx.set(self.revision_path(cid, 1), {"data": snapshot.model_dump_json()}, create=True)

        self.documents.transact(commit)
        return snapshot

    def metadata(self, case_id):
        case = self.documents.get(self.case_path(case_id))
        if case is None:
            raise KeyError("case not found")
        return {**case["metadata"], "tenant_id": case["tenant_id"], "revision": case["revision"]}

    def get(self, case_id, revision=None):
        version = revision if revision is not None else self.metadata(case_id)["revision"]
        row = self.documents.get(self.revision_path(case_id, version))
        if not row:
            raise KeyError("snapshot not found")
        snapshot = CaseSnapshot.model_validate_json(row["data"])
        if (
            not snapshot.valid_digest()
            or snapshot.case_id != case_id
            or snapshot.revision != version
        ):
            raise ValueError("corrupt_cloud_snapshot")
        return snapshot

    def audit_write(self, tx, case, event, revision=None):
        event_id = uuid.uuid4().hex
        tx.set(
            "audit/" + event_id,
            {
                "case_id": case["case_id"],
                "tenant_id": case["tenant_id"],
                "revision": revision or case["revision"],
                "event": event,
                "at": now(),
            },
            create=True,
        )

    def job_write(self, tx, case, revision, priority=0):
        jid = "JOB-" + identity(case["case_id"], revision)[:24]
        prior = tx.get("jobs/" + jid)
        if prior is None:
            tx.set(
                "jobs/" + jid,
                {
                    "job_id": jid,
                    "case_id": case["case_id"],
                    "tenant_id": case["tenant_id"],
                    "revision": revision,
                    "priority": priority,
                    "status": "queued",
                    "error": None,
                    "enqueued_at": time.time(),
                    "started_at": None,
                    "finished_at": None,
                    "attempt_count": 0,
                    "lease_token": None,
                    "lease_until": 0,
                },
                create=True,
            )
            self.intent_write(tx, jid, "process", jid)
        return jid

    def intent_write(self, tx, key, kind, resource_id):
        path = "task_intents/" + key
        if not tx.get(path):
            tx.set(
                path,
                {
                    "key": key,
                    "kind": kind,
                    "resource_id": resource_id,
                    "state": "pending",
                    "generation": 0,
                    "created_at": time.time(),
                },
                create=True,
            )

    def write_snapshot(self, tx, case, snapshot, event):
        if case.get("dispatch_guard", {}).get("until", 0) > time.time():
            raise ConflictError("approved_delivery_in_progress_retry")
        if snapshot.revision != case["revision"] + 1:
            raise ConflictError("revision_must_increment_once")
        snapshot.seal()
        tx.set(
            self.revision_path(snapshot.case_id, snapshot.revision),
            {"data": snapshot.model_dump_json()},
            create=True,
        )
        case.update(revision=snapshot.revision, digest=snapshot.digest)
        tx.set(self.case_path(snapshot.case_id), case)
        self.audit_write(tx, case, event)
        if event == "processed":
            record_id = snapshot.case_id + "-" + str(snapshot.revision)
            key = "COMPLAINT-" + identity(case["tenant_id"], record_id)
            reported_at = case["metadata"].get("reported_at", now())
            victim = case["metadata"].get("customer_account", "")
            payees = [m.resolved_fields.get("payee_vpa", "") for m in snapshot.ledger_matches]
            callers = [
                str(c.normalized_value)
                for c in snapshot.claims
                if c.kind == "caller_number"
                and c.evidence_state in {"reported", "source_supported"}
            ]
            payload = {
                "complaint_id": snapshot.case_id,
                "reported_at": reported_at,
                "amount_minor": sum(m.resolved_fields["amount"] for m in snapshot.ledger_matches),
                "payee": payees[0] if payees else "",
                "caller_number": callers[0] if callers else "",
                "links": [
                    {
                        "complaint_id": snapshot.case_id,
                        "victim": victim,
                        "txn_id": m.txn_id,
                        "disputed_amount": m.resolved_fields["amount"],
                        "reported_at": reported_at,
                    }
                    for m in snapshot.ledger_matches
                ],
                "identifiers": [
                    {"entity": victim, "kind": "caller_number", "value": value} for value in callers
                ],
            }
            tx.set(
                "bank_publications/" + key,
                {
                    "tenant": case["tenant_id"],
                    "record_id": record_id,
                    "kind": "complaints",
                    "digest": hash_json(payload),
                    "payload": canonical(payload),
                    "state": "pending",
                    "wake_state": "pending",
                },
                create=True,
            )
            self.intent_write(tx, key, "bank_publish", key)
        if event in PROCESS_EVENTS or event.startswith("bank_imported:"):
            self.job_write(tx, case, snapshot.revision, 0 if event.startswith("bank_") else 10)

    def publish(self, snapshot, expected_revision, event="updated", connection=None):
        if connection is not None:
            raise ValueError("SQL connections are not supported by Firestore")

        def commit(tx):
            case = tx.get(self.case_path(snapshot.case_id))
            execution = self.execution.get()
            if execution:
                job = tx.get("jobs/" + execution[0])
                if (
                    not job
                    or job["status"] != "running"
                    or job["lease_token"] != execution[1]
                    or job["lease_until"] < time.time()
                ):
                    raise ConflictError("job_lease_lost")
            if not case or case["revision"] != expected_revision:
                raise ConflictError("stale_revision")
            self.write_snapshot(tx, case, snapshot, event)

        self.documents.transact(commit)
        return snapshot

    def list_cases(self, tenant="demo"):
        rows = self.documents.query("cases", [("tenant_id", tenant)], limit=500)
        if len(rows) == 500:
            raise ValueError("workspace_pagination_required")
        return sorted(
            [{"case_id": r["case_id"], "revision": r["revision"]} for r in rows],
            key=lambda r: r["case_id"],
        )

    def cases_for_accounts(self, tenant, accounts):
        return [
            r["case_id"]
            for r in self.list_cases(tenant)
            if self.metadata(r["case_id"]).get("customer_account") in accounts
        ]

    def payment_decisions(self, cid):
        case = self.documents.get(self.case_path(cid))
        if not case:
            raise KeyError("case not found")
        return case.get("decisions", {})

    def record_approval(self, approval):
        path = "approvals/" + identity(approval.case_id, approval.revision)

        def commit(tx):
            case = tx.get(self.case_path(approval.case_id))
            if (
                not case
                or case["revision"] != approval.revision
                or case["digest"] != approval.digest
            ):
                raise ConflictError("stale_approval")
            if case["tenant_id"] != approval.reviewer.tenant_id:
                raise PermissionError("tenant mismatch")
            prior = tx.get(path)
            if prior:
                existing = Approval.model_validate_json(prior["data"])
                keys = ("digest", "disposition", "reason", "reviewer")
                if any(getattr(existing, k) != getattr(approval, k) for k in keys):
                    raise ConflictError("immutable_approval_requires_new_revision")
                return existing
            tx.set(
                path,
                {
                    "case_id": approval.case_id,
                    "revision": approval.revision,
                    "data": approval.model_dump_json(),
                },
                create=True,
            )
            self.audit_write(tx, case, "approved")
            return approval

        return self.documents.transact(commit)

    def approval(self, cid, revision):
        row = self.documents.get("approvals/" + identity(cid, revision))
        return Approval.model_validate_json(row["data"]) if row else None

    def approval_history(self, cid):
        return [
            json.loads(r["data"])
            for r in sorted(
                self.documents.query("approvals", [("case_id", cid)], limit=500),
                key=lambda r: r["revision"],
            )
        ]

    def audit(self, cid):
        return sorted(
            self.documents.query("audit", [("case_id", cid)], limit=500),
            key=lambda r: (r["revision"], r["at"]),
        )

    def assert_payload(self, value, other):
        if canonical(value) != canonical(other):
            raise ConflictError("immutable_payload_conflict")
