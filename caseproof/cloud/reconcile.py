"""Bounded reconciliation recovers publication gaps; never invents bank observations."""

import time
from datetime import datetime, timezone
from types import SimpleNamespace

from caseproof.adapters.cloud_tasks import CloudTasks, publish_pending
from caseproof.adapters.firestore_casestore import identity
from caseproof.adapters.sqlite_casestore import ConflictError
from caseproof.domain.clock import current_clock, urgency
from caseproof.domain.ledger import dt

ACTIVE_WINDOW_SECONDS = 2 * 3600


def reconcile(o):
    docs = o.store.documents
    # Recover exhausted/lost Tasks deliveries without changing the business intent.
    for status in ("queued", "running"):
        for job in docs.query("jobs", [("status", status)], limit=100):

            def recover(tx):
                latest = tx.get("jobs/" + job["job_id"])
                intent = tx.get("task_intents/" + job["job_id"])
                if not latest or not intent:
                    return
                expired = latest["status"] == "running" and latest["lease_until"] < time.time()
                lost = (
                    latest["status"] == "queued"
                    and intent["state"] == "published"
                    and intent.get("published_at", 0) < time.time() - 300
                )
                if not (expired or lost):
                    return
                from caseproof.cloud.runtime import MAX_JOB_ATTEMPTS

                if latest["attempt_count"] >= MAX_JOB_ATTEMPTS or intent["generation"] >= 3:
                    latest.update(status="failed", error="CLOUD_RETRY_BUDGET_EXHAUSTED")
                else:
                    latest.update(status="queued", lease_until=0, lease_token=None)
                    intent.update(state="pending", generation=intent["generation"] + 1)
                    tx.set("task_intents/" + job["job_id"], intent)
                tx.set("jobs/" + job["job_id"], latest)

            docs.transact(recover)
    pending_deliveries = docs.query("outbox", [("status", "pending")], limit=100) + docs.query(
        "outbox", [("status", "sending")], limit=100
    )
    for row in pending_deliveries:

        def recover_delivery(tx):
            latest = tx.get("outbox/" + row["key"])
            intent = tx.get("task_intents/" + row["key"])
            if not intent or latest["status"] in {"sent", "stale", "failed"}:
                return
            if (
                latest.get("lease_until", 0) > time.time()
                or intent.get("published_at", 0) > time.time() - 300
            ):
                return
            if latest.get("attempts", 0) >= 5 or intent["generation"] >= 3:
                latest.update(
                    status="failed", lease_until=0, error="DELIVERY_RETRY_BUDGET_EXHAUSTED"
                )
                intent.update(state="failed", error="DELIVERY_RETRY_BUDGET_EXHAUSTED")
                tx.set("outbox/" + row["key"], latest)
            else:
                intent.update(state="pending", generation=intent["generation"] + 1)
            tx.set("task_intents/" + row["key"], intent)

        docs.transact(recover_delivery)
    # Scan and bank publication commands can exhaust transport retries before
    # reaching their handler. Recover only unfinished resources, with a hard cap.
    for kind, collection, field in (
        ("scan", "evidence_scans", "status"),
        ("bank_publish", "bank_publications", "state"),
    ):
        for resource in docs.query(collection, [(field, "pending")], limit=100):
            resource_id = (
                resource["digest"]
                if kind == "scan"
                else (
                    {
                        "bank_batches": "BANK-",
                        "downstream_reports": "FEED-",
                        "complaints": "COMPLAINT-",
                    }[resource["kind"]]
                    + identity(resource["tenant"], resource["record_id"])
                )
            )
            task_key = "SCAN-" + resource_id if kind == "scan" else resource_id

            def recover_command(tx):
                path = "task_intents/" + task_key
                latest = tx.get(path)
                current = tx.get(collection + "/" + resource_id)
                if not latest or not current or current.get(field) != "pending":
                    return
                if (
                    latest["state"] != "published"
                    or latest.get("published_at", 0) > time.time() - 300
                ):
                    return
                if latest["generation"] >= 3:
                    latest.update(state="failed", error="COMMAND_RETRY_BUDGET_EXHAUSTED")
                else:
                    latest.update(state="pending", generation=latest["generation"] + 1)
                tx.set(path, latest)

            docs.transact(recover_command)
    o.bank_ingestion.reconcile()
    from caseproof.cloud.bank_network import CloudBankNetwork

    cutoff = datetime.fromtimestamp(time.time() - ACTIVE_WINDOW_SECONDS, timezone.utc).isoformat()
    cases = docs.query("cases", limit=500, lower_bound=("metadata.reported_at", cutoff))
    refreshed = set()
    for case in cases:
        cid = case["case_id"]
        if case.get("last_delivered_revision") == case["revision"]:
            continue  # Follow-up stays open, without polling unchanged demo banks forever.
        reported = case["metadata"].get("reported_at")
        if reported and dt(reported).timestamp() < time.time() - ACTIVE_WINDOW_SECONDS:
            # Past the golden hour and its follow-up window the clock no longer changes;
            # refreshing old practice banks would only flood the queue new cases share.
            continue
        snap = o.store.get(cid)
        if snap.clock and urgency(snap.clock) != urgency(current_clock(snap)):
            old = snap.revision
            snap.revision += 1
            try:
                o.store.publish(snap, old, "clock_changed")
            except ConflictError:
                pass
        if (
            not snap.ledger_matches
            or dt(
                case["metadata"].get("reported_at", datetime.now(timezone.utc).isoformat())
            ).timestamp()
            > time.time() - 30
        ):
            continue
        for network in docs.query("synthetic_networks", [("tenant", case["tenant_id"])], limit=20):
            if not any(
                c["account"] == case["metadata"].get("customer_account")
                for c in network["data"]["dataset"]["customers"]
            ):
                continue
            key = identity(case["tenant_id"], network["network_id"])
            if key in refreshed:
                continue
            last = docs.get("feed_refresh/" + key)
            if last and last["at"] > time.time() - 300:
                continue
            CloudBankNetwork(o).publish_reports(
                network["network_id"],
                SimpleNamespace(role="admin", tenant_id=case["tenant_id"]),
                refresh=True,
            )
            docs.transact(lambda tx: tx.set("feed_refresh/" + key, {"at": time.time()}))
            refreshed.add(key)
    client = CloudTasks(
        o.s.google_cloud_project,
        o.s.google_cloud_location,
        o.s.cloud_tasks_queue,
        o.s.cloud_worker_url,
        o.s.cloud_tasks_account,
    )
    return {
        "published": publish_pending(docs, client),
        "cases_checked": len(cases),
        "networks_refreshed": len(refreshed),
    }
