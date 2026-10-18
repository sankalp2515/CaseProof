"""Offline transactional model, not an assertion of live Google behavior."""

import copy
from threading import RLock

import pytest

from caseproof.adapters.firestore_casestore import FirestoreCaseStore
from caseproof.adapters.firestore_jobs import FirestoreJobs
from caseproof.adapters.sqlite_casestore import ConflictError
from caseproof.domain.contracts import Actor, Approval


class Documents:
    def __init__(self):
        self.rows, self.lock = {}, RLock()

    def get(self, path):
        return copy.deepcopy(self.rows.get(path))

    def query(self, collection, filters=(), limit=100, *, lower_bound=None):
        rows = [
            copy.deepcopy(v)
            for k, v in self.rows.items()
            if k.startswith(collection + "/") and all(v.get(f) == x for f, x in filters)
        ]
        if lower_bound is not None:
            field, minimum = lower_bound

            def value(row):
                for part in field.split("."):
                    row = row.get(part, {})
                return row

            rows = [r for r in rows if value(r) and value(r) >= minimum]
            rows.sort(key=value, reverse=True)
        return rows[:limit]

    def transact(self, operation):
        with self.lock:
            rows = copy.deepcopy(self.rows)

            class Tx:
                def get(self, path):
                    return copy.deepcopy(rows.get(path))

                def set(self, path, data, create=False):
                    if create and path in rows:
                        raise ConflictError("already exists")
                    rows[path] = copy.deepcopy(data)

            result = operation(Tx())
            self.rows = rows
            return result


def test_case_revision_and_job_intent_publish_atomically_and_history_is_immutable():
    docs = Documents()
    store = FirestoreCaseStore(docs)
    initial = store.create("C", customer_account="A")
    current = initial.model_copy(deep=True)
    current.revision += 1
    store.publish(current, 1, "artifact_added")
    assert store.get("C", 1).digest == initial.digest
    assert len(docs.query("jobs")) == len(docs.query("task_intents")) == 1
    assert store.get("C").revision == 2
    before = copy.deepcopy(docs.rows)
    with pytest.raises(ConflictError, match="stale_revision"):
        store.publish(current, 1)
    assert docs.rows == before


def test_conflicting_concurrent_publication_has_one_winner():
    from concurrent.futures import ThreadPoolExecutor

    store = FirestoreCaseStore(Documents())
    original = store.create("C")

    def publish(_):
        snap = original.model_copy(deep=True)
        snap.revision += 1
        try:
            store.publish(snap, 1, "artifact_added")
            return True
        except ConflictError:
            return False

    with ThreadPoolExecutor(max_workers=4) as pool:
        assert sum(pool.map(publish, range(4))) == 1
    assert len(store.documents.query("jobs")) == 1


def test_job_lease_fencing_duplicate_delivery_and_retry_generation():
    store = FirestoreCaseStore(Documents())
    store.create("C")
    jobs = FirestoreJobs(store)
    jid = jobs.enqueue("C", 1)
    assert jobs.enqueue("C", 1) == jid
    claimed = jobs.claim(jid)
    with pytest.raises(ConflictError, match="already_running"):
        jobs.claim(jid)
    with pytest.raises(ConflictError, match="lease_lost"):
        jobs.finish(jid, "done", lease_token="wrong")
    jobs.finish(jid, "failed", "PROVIDER_UNAVAILABLE", claimed["lease_token"])
    jobs.retry(jid)
    assert store.documents.get("task_intents/" + jid)["generation"] == 1
    claimed = jobs.claim(jid)
    jobs.finish(jid, "done", lease_token=claimed["lease_token"])
    assert jobs.claim(jid) is None
    assert jobs.get(jid)["attempt_count"] == 2


def test_approval_history_retries_and_stale_decisions():
    store = FirestoreCaseStore(Documents())
    snapshot = store.create("C")
    approval = Approval(
        approval_id="APP-1",
        case_id="C",
        revision=1,
        digest=snapshot.digest,
        disposition="COMPLETE_HANDOFF",
        reason="Checked",
        reviewer=Actor(user_id="reviewer", role="reviewer", tenant_id="demo"),
    )
    assert store.record_approval(approval) == store.record_approval(approval)
    with pytest.raises(ConflictError, match="immutable"):
        store.record_approval(approval.model_copy(update={"reason": "Changed"}))
    snapshot.revision += 1
    store.publish(snapshot, 1)
    with pytest.raises(ConflictError, match="stale_approval"):
        store.record_approval(approval)
    assert store.approval_history("C")[0]["approval_id"] == "APP-1"


def test_expired_worker_cannot_publish_even_if_case_revision_is_current():
    import time

    store = FirestoreCaseStore(Documents())
    snap = store.create("FENCED")
    jobs = FirestoreJobs(store)
    job = jobs.claim(jobs.enqueue("FENCED", 1))
    store.documents.rows["jobs/" + job["job_id"]]["lease_until"] = time.time() - 1
    snap.revision += 1
    with store.worker_fence(job), pytest.raises(ConflictError, match="lease"):
        store.publish(snap, 1, "processed")
    assert store.get("FENCED").revision == 1
