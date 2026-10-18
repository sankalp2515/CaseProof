"""Offline Google REST and failure-boundary tests; no live credentials or resources."""

import copy
from types import SimpleNamespace

import httpx
import pytest

from caseproof.adapters.bigquery_bank import BigQuery, BigQueryBank
from caseproof.adapters.cloud_bank_ingestion import CloudBankIngestion
from caseproof.adapters.cloud_tasks import CloudTasks, publish_pending
from caseproof.adapters.firestore_casestore import FirestoreCaseStore
from caseproof.adapters.firestore_documents import FirestoreDocuments, Transaction, decode, encode
from caseproof.adapters.sqlite_casestore import ConflictError
from caseproof.api.bank_contracts import BankBatch
from caseproof.domain.contracts import Actor
from local_services.bank_network import BankNetwork
from tests.unit.test_firestore_state import Documents


class HTTP:
    def __init__(self, responses):
        self.responses, self.calls = list(responses), []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        status, body = self.responses.pop(0)
        return httpx.Response(status, json=body, request=httpx.Request(method, url))

    def post(self, url, **kwargs):
        return self.request("POST", url, **kwargs)

    def get(self, url, **kwargs):
        return self.request("GET", url, **kwargs)


def test_reconcile_case_scan_respects_real_firestore_bound_and_recent_window(monkeypatch):
    from caseproof.cloud.reconcile import reconcile

    service = HTTP([(200, [])])
    production = FirestoreDocuments("caseproof-test", "offline", session=service)

    class StrictDocuments(Documents):
        def query(self, collection, filters=(), limit=100, **kwargs):
            if collection == "cases":
                return production.query(collection, filters, limit, **kwargs)
            return super().query(collection, filters, limit)

    monkeypatch.setattr("caseproof.cloud.reconcile.CloudTasks", lambda *a: SimpleNamespace())
    settings = SimpleNamespace(
        google_cloud_project="test",
        google_cloud_location="asia-south1",
        cloud_tasks_queue="queue",
        cloud_worker_url="https://worker.run.app",
        cloud_tasks_account="tasks@test.iam.gserviceaccount.com",
    )
    result = reconcile(
        SimpleNamespace(
            store=FirestoreCaseStore(StrictDocuments()),
            s=settings,
            bank_ingestion=SimpleNamespace(reconcile=lambda: None),
        )
    )
    assert result["cases_checked"] == 0
    query = service.calls[0][2]["json"]["structuredQuery"]
    assert query["limit"] <= 500
    assert query["where"]["fieldFilter"]["field"]["fieldPath"] == "metadata.reported_at"
    assert query["where"]["fieldFilter"]["op"] == "GREATER_THAN_OR_EQUAL"
    assert query["orderBy"][0]["direction"] == "DESCENDING"


def test_firestore_native_types_and_transaction_retry_and_create_preconditions():
    value = {"text": "हिन्दी", "money": 7327400, "flag": True, "empty": None, "rows": [1, 0.5]}
    assert decode(encode(value)) == value
    with pytest.raises(ValueError):
        encode(float("nan"))
    service = HTTP(
        [
            (200, {"transaction": "first"}),
            (404, {}),
            (409, {}),
            (200, {"transaction": "second"}),
            (404, {}),
            (200, {}),
        ]
    )
    docs = FirestoreDocuments("caseproof-test", "offline", session=service)
    calls = []

    def write(tx):
        calls.append(tx.token)
        assert tx.get("cases/new") is None
        tx.set("cases/new", value, create=True)
        assert tx.get("cases/new") == value  # buffered read-your-writes, no new API request
        tx.set("cases/new", {**value, "revision": 2})

    docs.transact(write)
    assert calls == ["first", "second"]
    writes = service.calls[-1][2]["json"]["writes"]
    assert len(writes) == 1 and writes[0]["currentDocument"] == {"exists": False}
    assert service.calls[1][2]["params"]["transaction"] == "first"


def test_firestore_transaction_size_limit_and_invalid_document_path():
    docs = FirestoreDocuments("caseproof-test", "offline", session=HTTP([]))
    with pytest.raises(ValueError):
        docs.name("cases/../escape")
    with pytest.raises(ValueError, match="size_limit"):
        Transaction(docs, "tx").set("cases/large", {"data": "x" * 900_000})


def test_bigquery_binds_account_and_tenant_and_caps_bytes_and_result_pages():
    service = HTTP([(200, {"jobComplete": True, "rows": []})])
    query = BigQuery("caseproof-test", "bank", "asia-south1", session=service)
    bank = BigQueryBank(query, "TENANT", Documents())
    bank.transactions("A' OR TRUE --", "2026-10-17T10:00:00Z")
    sent = service.calls[0][2]["json"]
    assert "A' OR TRUE" not in sent["query"]
    assert "b.tenant=@tenant" in sent["query"] and "received_at<=TIMESTAMP(@as_of)" in sent["query"]
    assert sent["maximumBytesBilled"] == "100000000" and sent["useLegacySql"] is False
    params = {p["name"]: p["parameterValue"]["value"] for p in sent["queryParameters"]}
    assert params["account"] == "A' OR TRUE --" and params["tenant"] == "TENANT"
    service.responses.append((200, {"jobComplete": True, "pageToken": "more"}))
    with pytest.raises(ValueError, match="result_limit"):
        query.query("SELECT 1", {})


def test_task_delivery_is_oidc_scoped_and_publication_failure_keeps_intent():
    http = HTTP([(200, {})])
    client = CloudTasks(
        "caseproof-test",
        "asia-south1",
        "processing",
        "https://worker-test.run.app",
        "tasks@caseproof-test.iam.gserviceaccount.com",
        session=http,
    )
    docs = Documents()
    intent = {
        "key": "JOB-1",
        "kind": "process",
        "resource_id": "JOB-1",
        "state": "pending",
        "generation": 0,
    }
    docs.rows["task_intents/JOB-1"] = intent
    assert publish_pending(docs, client) == 1
    request = http.calls[0][2]["json"]["task"]["httpRequest"]
    assert request["oidcToken"]["audience"] == "https://worker-test.run.app"
    assert request["url"].endswith("/internal/tasks/process")
    assert docs.get("task_intents/JOB-1")["state"] == "published"
    docs.rows["task_intents/JOB-1"]["state"] = "pending"
    http.responses.append((503, {}))
    with pytest.raises(httpx.HTTPStatusError):
        publish_pending(docs, client)
    assert docs.get("task_intents/JOB-1")["state"] == "pending"


def test_task_name_conflict_is_not_blindly_treated_as_success():
    http = HTTP([(409, {}), (200, {"httpRequest": {"url": "https://wrong.run.app"}})])
    client = CloudTasks(
        "caseproof-test",
        "asia-south1",
        "processing",
        "https://worker.run.app",
        "tasks@caseproof-test.iam.gserviceaccount.com",
        session=http,
    )
    with pytest.raises(ValueError, match="content_conflict"):
        client.publish({"key": "JOB-1", "kind": "process", "resource_id": "JOB-1", "generation": 0})


def bank_fixture():
    world = BankNetwork.__new__(BankNetwork)._generate("CLOUD-NEW", 113, "demo")
    return BankBatch.model_validate(world["dataset"])


def test_bank_publication_is_durable_and_conflicts_roll_back():
    docs = Documents()
    store = FirestoreCaseStore(docs)
    calls = []
    query = SimpleNamespace(publish=lambda *args: calls.append(args))
    ingestion = CloudBankIngestion(store, query)
    body, actor = bank_fixture(), Actor(user_id="bank", role="admin", tenant_id="demo")
    result = ingestion.ingest(body, actor)
    assert not calls and result["state"] == "pending"
    assert ingestion.ingest(body, actor)["duplicate"]
    before = copy.deepcopy(docs.rows)
    changed = body.model_copy(deep=True)
    changed.transactions[0].amount_minor += 1
    with pytest.raises(ConflictError):
        ingestion.ingest(changed, actor)
    assert docs.rows == before
    assert ingestion.publish(result["publication_id"])["published"]
    assert len(calls) == 1
    assert ingestion.publish(result["publication_id"])["duplicate"]


def test_bank_cross_tenant_adoption_is_rejected():
    docs = Documents()
    ingestion = CloudBankIngestion(FirestoreCaseStore(docs), SimpleNamespace())
    body = bank_fixture()
    ingestion.ingest(body, Actor(user_id="one", role="admin", tenant_id="ONE"))
    with pytest.raises(PermissionError):
        ingestion.ingest(body, Actor(user_id="two", role="admin", tenant_id="TWO"))


def test_completed_task_name_tombstone_rotates_durable_generation():
    http = HTTP([(409, {}), (404, {})])
    client = CloudTasks(
        "caseproof-test",
        "asia-south1",
        "processing",
        "https://worker.run.app",
        "tasks@caseproof-test.iam.gserviceaccount.com",
        session=http,
    )
    docs = Documents()
    docs.rows["task_intents/JOB-1"] = {
        "key": "JOB-1",
        "kind": "process",
        "resource_id": "JOB-1",
        "state": "pending",
        "generation": 0,
    }
    assert publish_pending(docs, client) == 0
    assert docs.get("task_intents/JOB-1")["generation"] == 1
    assert docs.get("task_intents/JOB-1")["state"] == "pending"


@pytest.mark.parametrize("generation, expected_state", [(0, "published"), (3, "failed")])
def test_reconciliation_recovers_scan_delivery_with_bounded_generations(
    monkeypatch, generation, expected_state
):
    import time

    from caseproof.cloud.reconcile import reconcile

    docs = Documents()
    digest = "a" * 64
    docs.rows["evidence_scans/" + digest] = {"digest": digest, "status": "pending"}
    key = "SCAN-" + digest
    docs.rows["task_intents/" + key] = {
        "key": key,
        "kind": "scan",
        "resource_id": digest,
        "generation": generation,
        "state": "published",
        "published_at": time.time() - 600,
    }
    monkeypatch.setattr(
        "caseproof.cloud.reconcile.CloudTasks",
        lambda *a: SimpleNamespace(publish=lambda item: "TASK"),
    )
    settings = SimpleNamespace(
        google_cloud_project="test",
        google_cloud_location="asia-south1",
        cloud_tasks_queue="queue",
        cloud_worker_url="https://worker.run.app",
        cloud_tasks_account="tasks@test.iam.gserviceaccount.com",
    )
    o = SimpleNamespace(
        store=FirestoreCaseStore(docs),
        bank_ingestion=SimpleNamespace(reconcile=lambda: None),
        s=settings,
    )
    reconcile(o)
    intent = docs.get("task_intents/" + key)
    assert intent["state"] == expected_state
    assert intent["generation"] == (1 if generation == 0 else 3)


def test_bank_coverage_replay_filters_received_time_and_linking_excludes_current_case():
    service = HTTP([(200, {"jobComplete": True, "rows": []})])
    bank = BigQueryBank(
        BigQuery("caseproof-test", "bank", "asia-south1", session=service), "demo", Documents()
    )
    bank.verification(
        "A", "demo", "2026-10-17T09:00:00Z", "2026-10-17T10:00:00Z", "2026-10-17T10:01:00Z"
    )
    assert "received_at<=TIMESTAMP(@as_of)" in service.calls[0][2]["json"]["query"]
    bank.exclude_case_id = "CURRENT"
    bank.client = SimpleNamespace(
        table=lambda name: name,
        query=lambda *a: [{"complaint_id": "CURRENT"}, {"complaint_id": "OTHER"}],
    )
    assert bank.complaints("start", "end") == [{"complaint_id": "OTHER"}]


def test_crashed_fifth_delivery_becomes_terminal_and_duplicate_is_acknowledged():
    import time

    from caseproof.cloud.outbound import dispatch

    docs = Documents()
    docs.rows["outbox/exhausted"] = {
        "key": "exhausted",
        "status": "sending",
        "attempts": 5,
        "lease_until": time.time() - 1,
    }
    o = SimpleNamespace(store=FirestoreCaseStore(docs))
    assert dispatch(o, "exhausted")["failed"]
    assert docs.get("outbox/exhausted")["status"] == "failed"
    assert dispatch(o, "exhausted")["failed"]


@pytest.mark.parametrize("generation", [0, 3])
def test_completed_outbox_history_cannot_hide_pending_recovery(monkeypatch, generation):
    import time

    from caseproof.cloud.reconcile import reconcile

    docs = Documents()
    for i in range(105):
        docs.rows[f"outbox/old-{i}"] = {"key": f"old-{i}", "status": "sent"}
    docs.rows["outbox/new"] = {"key": "new", "status": "pending", "lease_until": 0}
    docs.rows["task_intents/new"] = {
        "key": "new",
        "kind": "outbound",
        "resource_id": "new",
        "generation": generation,
        "state": "published",
        "published_at": time.time() - 600,
    }
    monkeypatch.setattr(
        "caseproof.cloud.reconcile.CloudTasks",
        lambda *a: SimpleNamespace(publish=lambda item: "TASK"),
    )
    settings = SimpleNamespace(
        google_cloud_project="test",
        google_cloud_location="asia-south1",
        cloud_tasks_queue="queue",
        cloud_worker_url="https://worker.run.app",
        cloud_tasks_account="tasks@test.iam.gserviceaccount.com",
    )
    reconcile(
        SimpleNamespace(
            store=FirestoreCaseStore(docs),
            bank_ingestion=SimpleNamespace(reconcile=lambda: None),
            s=settings,
        )
    )
    assert docs.get("task_intents/new")["generation"] == (1 if generation == 0 else 3)
    assert docs.get("outbox/new")["status"] == ("pending" if generation == 0 else "failed")


def test_shared_model_cap_counts_failed_calls_and_duplicate_cache_is_free():
    from caseproof.adapters.firestore_llm_cache import FirestoreLLMCache
    from caseproof.adapters.llm_cache import CallCapError

    docs = Documents()
    cache = FirestoreLLMCache(
        SimpleNamespace(llm_mode="live", llm_max_calls_per_case=2, llm_daily_call_cap=2), docs
    )
    result = cache.call(
        "C", "vertex", "model", "prompt", {"input": 1}, lambda: ({"value": 1}, None)
    )
    assert result["run"]["mode"] == "live"
    assert (
        cache.call(
            "C", "vertex", "model", "prompt", {"input": 1}, lambda: pytest.fail("cache miss")
        )["run"]["mode"]
        == "cache"
    )

    def failed():
        raise RuntimeError("provider unavailable")

    with pytest.raises(RuntimeError):
        cache.call("C", "vertex", "model", "prompt", {"input": 2}, failed)
    with pytest.raises(CallCapError):
        cache.call("C", "vertex", "model", "prompt", {"input": 3}, lambda: ({}, None))


def test_related_complaints_are_bounded_by_observation_time():
    service = HTTP([(200, {"jobComplete": True, "rows": []})])
    bank = BigQueryBank(
        BigQuery("caseproof-test", "bank", "asia-south1", session=service), "demo", Documents()
    )
    bank.observation_as_of = "2026-10-17T10:01:00Z"
    bank.complaints("2026-10-14T10:00:00Z", "2026-10-17T10:00:00Z")
    sent = service.calls[0][2]["json"]
    assert "received_at<=TIMESTAMP(@as_of)" in sent["query"]
    assert (
        next(p for p in sent["queryParameters"] if p["name"] == "as_of")["parameterValue"]["value"]
        == bank.observation_as_of
    )
