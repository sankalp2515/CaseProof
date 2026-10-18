"""Revision-bound outbound intents and short fenced dispatch authorization."""

import time
import uuid

from caseproof.adapters.cloud_service import CloudService
from caseproof.adapters.firestore_casestore import identity
from caseproof.adapters.sqlite_casestore import ConflictError
from caseproof.domain.contracts import Approval, CaseSnapshot, hash_json
from caseproof.domain.freshness import require_fresh_handoff
from caseproof.domain.packet import build_packet
from caseproof.domain.review import approved_snapshot


def prepare(o, cid):
    snap, approval = approved_snapshot(o.store, cid)
    packet = build_packet(snap, approval)
    from caseproof.adapters.gcs_packets import archive_packet

    archive_packet(o.storage.evidence, packet)

    def commit(tx):
        case = tx.get(o.store.case_path(cid))
        recorded = tx.get("approvals/" + identity(cid, snap.revision))
        if case["revision"] != snap.revision or case["digest"] != snap.digest or not recorded:
            raise ConflictError("stale_export")
        if Approval.model_validate_json(recorded["data"]).approval_id != approval.approval_id:
            raise ConflictError("approval_required_or_stale")
        # Both receivers must get the same approved packet: automatic bank updates
        # wait until delivery finishes (new customer evidence still invalidates it).
        case["export_guard"] = {"until": time.time() + 180, "packet_id": packet.packet_id}
        tx.set(o.store.case_path(cid), case)
        for kind in ("case_ticket", "cfcfrms_report_update"):
            payload = (
                packet.model_dump(mode="json") if kind == "case_ticket" else packet.report_update
            )
            key = hash_json({"packet_id": packet.packet_id, "kind": kind})
            prior = tx.get("outbox/" + key)
            if prior:
                o.store.assert_payload(prior["payload"], payload)
                if prior["status"] == "sent":
                    continue
            require_fresh_handoff(snap, require_coverage=approval.disposition == "COMPLETE_HANDOFF")
            if prior is None:
                tx.set(
                    "outbox/" + key,
                    {
                        "key": key,
                        "packet_id": packet.packet_id,
                        "case_id": cid,
                        "revision": snap.revision,
                        "digest": snap.digest,
                        "kind": kind,
                        "payload": payload,
                        "status": "pending",
                        "response": None,
                        "attempts": 0,
                        "lease_until": 0,
                        "lease_token": None,
                    },
                    create=True,
                )
                o.store.intent_write(tx, key, "outbound", key)
        return packet

    return o.store.documents.transact(commit)


def dispatch(o, key, *, service=None):
    token = uuid.uuid4().hex

    def claim(tx):
        row = tx.get("outbox/" + key)
        if not row:
            raise KeyError("delivery intent missing")
        if row["status"] == "sent":
            return row
        if row["status"] in {"failed", "stale"}:
            return row
        if row["attempts"] >= 5:
            if row.get("lease_until", 0) > time.time():
                raise ConflictError("delivery_in_progress")
            row.update(status="failed", lease_until=0, error="DELIVERY_RETRY_BUDGET_EXHAUSTED")
            tx.set("outbox/" + key, row)
            return row
        case = tx.get(o.store.case_path(row["case_id"]))
        if case["revision"] != row["revision"] or case["digest"] != row["digest"]:
            row["status"] = "stale"
            tx.set("outbox/" + key, row)
            return row
        if case.get("dispatch_guard", {}).get("until", 0) > time.time():
            raise ConflictError("delivery_in_progress")
        snap = CaseSnapshot.model_validate_json(
            tx.get(o.store.revision_path(row["case_id"], row["revision"]))["data"]
        )
        if not snap.valid_digest():
            raise ValueError("corrupt_cloud_snapshot")
        if row["kind"] == "urgent_referral":
            from caseproof.domain.referral import describe

            if not describe(snap)["eligible"]:
                raise ValueError("stale_referral")
        else:
            approval = tx.get("approvals/" + identity(row["case_id"], row["revision"]))
            if not approval:
                raise ConflictError("approval_required_or_stale")
            decision = Approval.model_validate_json(approval["data"])
            if (
                decision.approval_id != row["payload"]["approval_id"]
                or decision.digest != row["digest"]
            ):
                raise ConflictError("approval_digest_mismatch")
            require_fresh_handoff(snap, require_coverage=decision.disposition == "COMPLETE_HANDOFF")
        row.update(
            status="sending",
            lease_token=token,
            lease_until=time.time() + 90,
            attempts=row["attempts"] + 1,
        )
        case["dispatch_guard"] = {"token": token, "until": row["lease_until"]}
        tx.set(o.store.case_path(row["case_id"]), case)
        tx.set("outbox/" + key, row)
        return row

    row = o.store.documents.transact(claim)
    if row["status"] == "sent":
        return row["response"]
    if row["status"] in {"stale", "failed"}:
        return {"acknowledged": True, row["status"]: True}
    try:
        if row["payload"].get("synthetic") is not True:
            raise ValueError("synthetic outbound only")
        target = service if service is not None else CloudService(o.s.cloud_simulator_url)
        receipt = target.post("/" + row["kind"], json=row["payload"], key=key)

        def finish(tx):
            latest = tx.get("outbox/" + key)
            case = tx.get(o.store.case_path(row["case_id"]))
            if latest["lease_token"] != token:
                raise ConflictError("delivery_lease_lost")
            latest.update(status="sent", response=receipt, lease_until=0)
            tx.set("outbox/" + key, latest)
            if row["kind"] != "urgent_referral":
                other_kind = (
                    "case_ticket"
                    if row["kind"] == "cfcfrms_report_update"
                    else "cfcfrms_report_update"
                )
                other = tx.get(
                    "outbox/" + hash_json({"packet_id": row["packet_id"], "kind": other_kind})
                )
                if other and other["status"] == "sent":
                    case["last_delivered_revision"] = row["revision"]
            if case.get("dispatch_guard", {}).get("token") == token:
                case.pop("dispatch_guard")
                tx.set(o.store.case_path(row["case_id"]), case)
            o.store.audit_write(tx, case, "delivery_acknowledged:" + row["kind"], row["revision"])

        o.store.documents.transact(finish)
        return receipt
    except Exception:

        def failed(tx):
            latest = tx.get("outbox/" + key)
            case = tx.get(o.store.case_path(row["case_id"]))
            if latest["lease_token"] == token and latest["status"] != "sent":
                latest.update(
                    status="failed" if latest["attempts"] >= 5 else "pending",
                    error="OUTBOUND_UNAVAILABLE",
                    lease_until=0,
                )
                tx.set("outbox/" + key, latest)
            if case.get("dispatch_guard", {}).get("token") == token:
                case.pop("dispatch_guard")
                tx.set(o.store.case_path(row["case_id"]), case)

        o.store.documents.transact(failed)
        raise


def delivered_packet(store, cid, pid):
    rows = store.documents.query("outbox", [("case_id", cid)], limit=100)
    for row in rows:
        if (
            row["kind"] == "case_ticket"
            and row["status"] == "sent"
            and row["payload"].get("packet_id") == pid
        ):
            return row["payload"]
    raise KeyError("delivered packet missing")
