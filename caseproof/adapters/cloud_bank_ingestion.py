"""Immutable bank imports: reserve identities and publish analytical copies durably."""

import time

from caseproof.adapters.firestore_casestore import identity
from caseproof.adapters.sqlite_casestore import ConflictError
from caseproof.domain.contracts import canonical, hash_json


class CloudBankIngestion:
    def __init__(self, store, bigquery):
        self.store, self.documents, self.bigquery = store, store.documents, bigquery

    def ingest(self, body, actor):
        if actor.role != "admin" or body.synthetic is not True:
            raise PermissionError("synthetic bank administrator required")
        # Keep the initial cloud transaction below its declared write/query budgets.
        if len(body.accounts) + len(body.transactions) > 80:
            raise ValueError("cloud_bank_batch_limit_split_required")
        payload = body.model_dump(mode="json")
        key = "BANK-" + identity(actor.tenant_id, body.batch_id)
        path = "bank_publications/" + key
        digest = hash_json(payload)

        def reserve(tx):
            old = tx.get(path)
            if old:
                if old["digest"] != digest:
                    raise ConflictError("bank_batch_id_content_conflict")
                return {
                    "batch_id": body.batch_id,
                    "duplicate": True,
                    "synthetic": True,
                    "publication_id": key,
                    "state": old["state"],
                }
            owners = {}
            for account in body.accounts:
                owner_path = "bank_owners/" + identity(account.id)
                prior = tx.get(owner_path)
                data = account.model_dump()
                if prior and prior["tenant"] != actor.tenant_id:
                    raise PermissionError("bank account belongs to another tenant")
                if prior and prior["account"] != data:
                    raise ConflictError("immutable_bank_account_conflict")
                owners[account.id] = prior or {
                    "tenant": actor.tenant_id,
                    "account": data,
                    "debits": 0,
                }
            for payment in body.transactions:
                ppath = "bank_transactions/" + identity(payment.txn_id)
                prior = tx.get(ppath)
                data = payment.model_dump()
                if prior and (prior["tenant"] != actor.tenant_id or prior["data"] != data):
                    raise ConflictError("immutable_bank_transaction_conflict")
                if prior is None:
                    owners[payment.account]["debits"] += payment.amount_minor
                    tx.set(ppath, {"tenant": actor.tenant_id, "data": data}, create=True)
            for account_id, owner in owners.items():
                if (
                    owner["account"]["kind"] == "customer"
                    and owner["debits"] > owner["account"]["opening_balance"]
                ):
                    raise ValueError("synthetic debit history exceeds supplied opening funds")
                tx.set("bank_owners/" + identity(account_id), owner)
            for customer in body.customers:
                cpath = "bank_customers/" + identity(actor.tenant_id, customer.account)
                profile = {**customer.model_dump(), "bank": body.bank, "synthetic": True}
                old_profile = tx.get(cpath)
                if old_profile and old_profile["profile"] != profile:
                    raise ConflictError("immutable_bank_customer_conflict")
                if not old_profile:
                    tx.set(cpath, {"tenant": actor.tenant_id, "profile": profile}, create=True)
            tx.set(
                path,
                {
                    "tenant": actor.tenant_id,
                    "record_id": body.batch_id,
                    "kind": "bank_batches",
                    "digest": digest,
                    "payload": canonical(payload),
                    "state": "pending",
                    "wake_state": "pending",
                },
                create=True,
            )
            self.store.intent_write(tx, key, "bank_publish", key)
            return {
                "batch_id": body.batch_id,
                "duplicate": False,
                "synthetic": True,
                "publication_id": key,
                "state": "pending",
            }

        return self.documents.transact(reserve)

    def publish(self, key, written=False):
        path = "bank_publications/" + key
        row = self.documents.get(path)
        if not row:
            raise KeyError("bank publication not found")
        if row["state"] == "published":
            if row.get("wake_state") == "pending":
                self.wake_cases(key, row)
            return {"published": True, "duplicate": True}
        if not written:
            self.bigquery.publish(
                row["kind"], row["tenant"], row["record_id"], row["digest"], row["payload"]
            )

        def acknowledge(tx):
            current = tx.get(path)
            if current["digest"] != row["digest"]:
                raise ConflictError("bank_publication_changed")
            current["state"] = "published"
            tx.set(path, current)

        self.documents.transact(acknowledge)
        # Retrying after a crash here replays immutable analytical writes and wakeups.
        self.wake_cases(key, row)
        return {"published": True, "duplicate": False}

    def publish_many(self, keys):
        """Publish several pending publications of one tenant and kind with a single
        BigQuery statement; anything else falls back to one-by-one publication."""
        rows = {k: self.documents.get("bank_publications/" + k) for k in dict.fromkeys(keys)}
        pending = {k: r for k, r in rows.items() if r and r["state"] != "published"}
        groups = {}
        for k, r in pending.items():
            groups.setdefault((r["kind"], r["tenant"]), []).append(k)
        batched = getattr(self.bigquery, "publish_many", None)
        for (kind, tenant), group in groups.items():
            written = bool(batched and len(group) > 1)
            if written:
                batched(
                    kind,
                    tenant,
                    [
                        (pending[k]["record_id"], pending[k]["digest"], pending[k]["payload"])
                        for k in group
                    ],
                )
            # Acknowledge and wake through the single-record path without a second write.
            for k in group:
                self.publish(k, written=written)

    def wake_cases(self, key, row):
        import json

        body = json.loads(row["payload"])
        accounts = {c["account"] for c in body.get("coverage", [])}
        if row["kind"] in ("downstream_reports", "complaints"):
            # A newly processed complaint may link to earlier complaints in the same
            # tenant; those cases must re-run linking (the filter below keeps it to
            # cases that share a payee or caller and do not link it yet).
            candidates = self.store.list_cases(row["tenant"])
        else:
            candidates = [
                {"case_id": cid} for cid in self.store.cases_for_accounts(row["tenant"], accounts)
            ]
        for item in candidates:
            cid = item["case_id"]
            ack_path = "bank_wakeups/" + identity(key, cid)

            def wake(tx):
                if tx.get(ack_path):
                    return
                case = tx.get(self.store.case_path(cid))
                if case.get("export_guard", {}).get("until", 0) > time.time():
                    # An approved packet is being delivered; apply this observation after.
                    raise ConflictError("approved_delivery_in_progress_retry")
                current = tx.get(self.store.revision_path(cid, case["revision"]))
                from caseproof.domain.contracts import CaseSnapshot

                snap = CaseSnapshot.model_validate_json(current["data"])
                if row["kind"] == "complaints":
                    from caseproof.domain.validator import normalized

                    mine = {
                        normalized(v)
                        for v in [m.resolved_fields.get("payee_vpa") for m in snap.ledger_matches]
                        + [
                            str(c.normalized_value)
                            for c in snap.claims
                            if c.kind in ("payee_vpa", "caller_number")
                        ]
                        if v
                    }
                    shared = {
                        normalized(body.get("payee") or ""),
                        normalized(body.get("caller_number") or ""),
                    } - {normalized("")}
                    from caseproof.domain.ledger import dt

                    # Linking looks back 72 hours from a case's own report, so only a
                    # case reported after this complaint can ever link to it.
                    reported = case["metadata"].get("reported_at")
                    if (
                        cid == body["complaint_id"]
                        or not reported
                        or dt(reported) < dt(body["reported_at"])
                        or not mine & shared
                        or any(link.complaint_id == body["complaint_id"] for link in snap.linked)
                    ):
                        tx.set(
                            ack_path,
                            {"publication": key, "case_id": cid, "irrelevant": True},
                            create=True,
                        )
                        return
                if row["kind"] == "downstream_reports":
                    known_accounts = {a["id"] for a in snap.trail.get("accounts", [])}
                    payment_ids = {m.txn_id for m in snap.ledger_matches}
                    if body["account"] not in known_accounts and not any(
                        edge["txn_id"] in payment_ids for edge in body["credit_received"]
                    ):
                        tx.set(
                            ack_path,
                            {"publication": key, "case_id": cid, "irrelevant": True},
                            create=True,
                        )
                        return
                snap.revision += 1
                snap.readiness.disposition = "REVIEW_REQUIRED"
                self.store.write_snapshot(tx, case, snap, "bank_imported:" + key)
                tx.set(ack_path, {"publication": key, "case_id": cid}, create=True)

            self.documents.transact(wake)

        def finish(tx):
            publication = tx.get("bank_publications/" + key)
            publication["wake_state"] = "done"
            tx.set("bank_publications/" + key, publication)

        self.documents.transact(finish)

    def downstream(self, report, actor):
        import time
        from datetime import datetime, timezone

        from caseproof.adapters.local_trail_feed import validate_updates

        if actor.role != "admin":
            raise PermissionError("bank feed identity required")
        validate_updates([report], datetime.now(timezone.utc).isoformat())
        owner = self.documents.get("bank_owners/" + identity(report["account"]))
        if (
            not owner
            or owner["tenant"] != actor.tenant_id
            or owner["account"]["bank"] != report["reporting_bank"]
        ):
            raise PermissionError("reporting bank does not own this observed account")
        key = "FEED-" + identity(actor.tenant_id, report["update_id"])

        def reserve(tx):
            path = "bank_publications/" + key
            old = tx.get(path)
            if old and old["digest"] != hash_json(report):
                raise ConflictError("changed feed update ID")
            if not old:
                tx.set(
                    path,
                    {
                        "tenant": actor.tenant_id,
                        "record_id": report["update_id"],
                        "kind": "downstream_reports",
                        "digest": hash_json(report),
                        "payload": canonical(report),
                        "state": "pending",
                        "wake_state": "pending",
                        "at": time.time(),
                    },
                    create=True,
                )
                self.store.intent_write(tx, key, "bank_publish", key)
            return {"publication_id": key, "duplicate": bool(old)}

        return self.documents.transact(reserve)

    def reconcile(self):
        # Published records are also examined: an acknowledgement can precede a crash
        # before wakeup publication. Per-case markers make recovery idempotent.
        for row in self.documents.query(
            "bank_publications", [("state", "published"), ("wake_state", "pending")], limit=100
        ):
            prefix = {
                "bank_batches": "BANK-",
                "downstream_reports": "FEED-",
                "complaints": "COMPLAINT-",
            }[row["kind"]]
            key = prefix + identity(row["tenant"], row["record_id"])
            if row["state"] == "published":
                self.wake_cases(key, row)
