"""Tenant-scoped, byte-capped BigQuery records; no LLM-written SQL."""

import json
import re
import time
from datetime import datetime, timedelta, timezone

from caseproof.adapters.google_http import authorized_session
from caseproof.domain.ledger import dt


class BigQuery:
    def __init__(self, project, dataset, location, *, maximum_bytes=100_000_000, session=None):
        if not re.fullmatch(r"[a-z][a-z0-9-]{4,61}[a-z0-9]", project or ""):
            raise ValueError("Explicit BigQuery project required")
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,100}", dataset or ""):
            raise ValueError("Invalid dataset")
        if (
            not re.fullmatch(r"[a-z]+-[a-z]+[0-9]", location or "")
            or not 10_000_000 <= maximum_bytes <= 100_000_000
        ):
            raise ValueError("Regional, bounded BigQuery configuration required")
        self.project, self.dataset, self.location = project, dataset, location
        self.maximum_bytes, self.session = (
            maximum_bytes,
            session if session is not None else authorized_session(),
        )

    def table(self, name):
        if name not in {"bank_batches", "downstream_reports", "complaints"}:
            raise ValueError("Unknown bank table")
        return f"`{self.project}.{self.dataset}.{name}`"

    def query(self, sql, parameters):
        url = f"https://bigquery.googleapis.com/bigquery/v2/projects/{self.project}/queries"
        response = self.session.post(
            url,
            json={
                "query": sql,
                "useLegacySql": False,
                "location": self.location,
                "maximumBytesBilled": str(self.maximum_bytes),
                "maxResults": 501,
                "timeoutMs": 1000,
                "parameterMode": "NAMED",
                "queryParameters": [
                    {"name": k, "parameterType": {"type": "STRING"}, "parameterValue": {"value": v}}
                    for k, v in parameters.items()
                ],
            },
            timeout=15,
        )
        response.raise_for_status()
        result, deadline = response.json(), time.monotonic() + 45
        while not result.get("jobComplete", True):
            if time.monotonic() > deadline:
                raise TimeoutError("BIGQUERY_QUERY_TIMEOUT")
            job = result["jobReference"]
            if not re.fullmatch(r"[A-Za-z0-9_-]+", job["jobId"]):
                raise ValueError("Invalid query job")
            time.sleep(0.2)
            response = self.session.get(
                url + "/" + job["jobId"],
                params={"location": self.location, "maxResults": 501},
                timeout=10,
            )
            response.raise_for_status()
            result = response.json()
            result.setdefault("jobReference", job)
        if result.get("errors"):
            raise RuntimeError("BIGQUERY_QUERY_FAILED")
        rows = result.get("rows", [])
        if result.get("pageToken") or len(rows) > 500:
            raise ValueError("bank_query_result_limit")
        return [json.loads(row["f"][0]["v"]) for row in rows]

    def publish(self, table, tenant, record_id, digest, payload):
        target = self.table(table)
        # Firestore reserves immutable identity; repeated SQL publication is deduplicated.
        extra_columns = ",reported_at" if table == "downstream_reports" else ""
        extra_values = ",TIMESTAMP(JSON_VALUE(@payload,'$.reported_at'))" if extra_columns else ""
        # One MERGE statement: atomic by itself, and BigQuery queues concurrent DML on
        # a table instead of aborting it the way multi-statement transactions are.
        # A different digest for an existing id raises, keeping records immutable.
        statement = f"""
            MERGE {target} t USING (SELECT @tenant tenant,@id id,@digest digest) s
            ON t.tenant=s.tenant AND t.id=s.id
            WHEN MATCHED AND t.digest!=s.digest THEN
                UPDATE SET digest=ERROR('immutable batch')
            WHEN NOT MATCHED THEN INSERT(tenant,id,digest,payload,received_at{extra_columns})
            VALUES(@tenant,@id,@digest,@payload,CURRENT_TIMESTAMP(){extra_values})
        """
        parameters = {"tenant": tenant, "id": record_id, "digest": digest, "payload": payload}
        for attempt in range(4):
            try:
                self.query(statement, parameters)
                return
            except Exception as error:  # requests HTTPError carries BigQuery's message
                body = getattr(getattr(error, "response", None), "text", "") or ""
                if "concurrent update" not in body or attempt == 3:
                    raise
                time.sleep(1 + attempt * 2)

    def publish_many(self, table, tenant, rows):
        """rows: [(record_id, digest, payload)]. One MERGE for several records:
        BigQuery runs DML on a table one statement at a time, so a session's
        batches publish in one round trip instead of queueing six."""
        if not rows:
            return
        target = self.table(table)
        extra_columns = ",reported_at" if table == "downstream_reports" else ""
        extra_values = ",TIMESTAMP(JSON_VALUE(s.payload,'$.reported_at'))" if extra_columns else ""
        source = " UNION ALL ".join(
            f"SELECT @tenant tenant,@id{i} id,@digest{i} digest,@payload{i} payload"
            for i in range(len(rows))
        )
        statement = f"""
            MERGE {target} t USING ({source}) s
            ON t.tenant=s.tenant AND t.id=s.id
            WHEN MATCHED AND t.digest!=s.digest THEN
                UPDATE SET digest=ERROR('immutable batch')
            WHEN NOT MATCHED THEN INSERT(tenant,id,digest,payload,received_at{extra_columns})
            VALUES(s.tenant,s.id,s.digest,s.payload,CURRENT_TIMESTAMP(){extra_values})
        """
        parameters = {"tenant": tenant}
        for i, (record_id, digest, payload) in enumerate(rows):
            parameters.update({f"id{i}": record_id, f"digest{i}": digest, f"payload{i}": payload})
        for attempt in range(4):
            try:
                self.query(statement, parameters)
                return
            except Exception as error:
                body = getattr(getattr(error, "response", None), "text", "") or ""
                if "concurrent update" not in body or attempt == 3:
                    raise
                time.sleep(1 + attempt * 2)


class BigQueryBank:
    def __init__(self, client, tenant, documents, max_age=900):
        if not tenant or len(tenant) > 100:
            raise ValueError("Explicit bank tenant required")
        self.client, self.tenant, self.documents = client, tenant, documents
        self.max_age = max_age

    def batches(self, as_of=None):
        # Each refresh adds a coverage-only batch; only the latest one per original
        # batch matters (it covers the whole window), so long sessions stay small.
        return self.client.query(
            f"WITH b AS (SELECT id, payload, received_at FROM {self.client.table('bank_batches')} "
            "WHERE tenant=@tenant "
            + ("AND received_at<=TIMESTAMP(@as_of) " if as_of else "")
            + "QUALIFY ROW_NUMBER() OVER(PARTITION BY id ORDER BY received_at)=1) "
            "SELECT payload FROM b WHERE TRUE QUALIFY STRPOS(id, '-REFRESH-')=0 "
            "OR ROW_NUMBER() OVER(PARTITION BY SPLIT(id, '-REFRESH-')[OFFSET(0)], "
            "STRPOS(id, '-REFRESH-')>0 ORDER BY received_at DESC, id DESC)=1",
            {"tenant": self.tenant, **({"as_of": as_of} if as_of else {})},
        )

    def transactions(self, account, as_of=None):
        instant = as_of or datetime.now(timezone.utc).isoformat()
        return self.client.query(
            f"""
            SELECT TO_JSON_STRING(STRUCT(
                JSON_VALUE(t,'$.txn_id') AS txn_id, JSON_VALUE(t,'$.account') AS account,
                CAST(JSON_VALUE(t,'$.amount_minor') AS INT64) AS amount_minor,
                JSON_VALUE(t,'$.payee') AS payee, JSON_VALUE(t,'$.ts') AS ts,
                JSON_VALUE(t,'$.reference') AS reference,
                JSON_VALUE(t,'$.direction') AS direction
            )) FROM {self.client.table("bank_batches")} b,
            UNNEST(JSON_QUERY_ARRAY(b.payload,'$.transactions')) t
            WHERE b.tenant=@tenant AND JSON_VALUE(t,'$.account')=@account
              AND received_at<=TIMESTAMP(@as_of)
              AND TIMESTAMP(JSON_VALUE(t,'$.ts'))<=TIMESTAMP(@as_of)
              AND EXISTS(SELECT 1 FROM UNNEST(JSON_QUERY_ARRAY(b.payload,'$.coverage')) c
                WHERE JSON_VALUE(c,'$.account')=@account
                  AND TIMESTAMP(JSON_VALUE(c,'$.as_of'))<=TIMESTAMP(@as_of)
                  AND TIMESTAMP(JSON_VALUE(t,'$.ts')) BETWEEN
                      TIMESTAMP(JSON_VALUE(c,'$.start')) AND TIMESTAMP(JSON_VALUE(c,'$.end')))
            QUALIFY ROW_NUMBER() OVER(PARTITION BY JSON_VALUE(t,'$.txn_id') ORDER BY received_at)=1
            ORDER BY TIMESTAMP(JSON_VALUE(t,'$.ts'))
        """,
            {"tenant": self.tenant, "account": account, "as_of": instant},
        )

    def complaints(self, start, end):
        rows = self.client.query(
            f"SELECT payload FROM {self.client.table('complaints')} WHERE tenant=@tenant "
            "AND TIMESTAMP(JSON_VALUE(payload,'$.reported_at')) "
            "BETWEEN TIMESTAMP(@start) AND TIMESTAMP(@end) "
            "AND received_at<=TIMESTAMP(@as_of) "
            "QUALIFY ROW_NUMBER() OVER(PARTITION BY JSON_VALUE(payload,'$.complaint_id') "
            "ORDER BY received_at DESC)=1",
            {
                "tenant": self.tenant,
                "start": start,
                "end": end,
                "as_of": getattr(self, "observation_as_of", end),
            },
        )

        return [r for r in rows if r.get("complaint_id") != getattr(self, "exclude_case_id", None)]

    def check_account(self, account, tenant):
        from caseproof.adapters.firestore_casestore import identity

        if tenant != self.tenant:
            raise PermissionError("bank tenant mismatch")
        owner = self.documents.get("bank_owners/" + identity(account))
        if owner and owner["tenant"] != tenant:
            raise PermissionError("bank account belongs to another tenant")

    def customers(self, tenant):
        if tenant != self.tenant:
            raise PermissionError("bank tenant mismatch")
        result = {}
        for batch in self.batches():
            for customer in batch["customers"]:
                result[customer["account"]] = {**customer, "bank": batch["bank"], "synthetic": True}
        return list(result.values())

    def verification(self, account, tenant, start, end, as_of=None):
        from caseproof.domain.freshness import observation_freshness

        self.check_account(account, tenant)
        records = [
            (batch["batch_id"], c)
            for batch in self.batches(as_of)
            for c in batch["coverage"]
            if c["account"] == account and (not as_of or dt(c["as_of"]) <= dt(as_of))
        ]

        def cover(rows):
            cursor, used = dt(start) - timedelta(hours=2), []
            for bid, c in sorted(
                rows, key=lambda row: (dt(row[1]["start"]), -dt(row[1]["as_of"]).timestamp())
            ):
                if dt(c["start"]) <= cursor < dt(c["end"]):
                    cursor = dt(c["end"])
                    used.append((bid, c))
            return cursor >= dt(end), used

        complete_interval, historical = cover(records)
        fresh = [
            r
            for r in records
            if not as_of
            or observation_freshness(r[1]["as_of"], as_of, self.max_age)["state"] == "fresh"
        ]
        complete, used = cover(fresh)
        chosen = used if complete else historical
        observed = min((c["as_of"] for _, c in chosen), key=dt, default=None)
        return {
            "complete": complete,
            "interval_complete": complete_interval,
            "observed_at": observed,
            "batch_ids": sorted({bid for bid, _ in chosen}),
            "account": account,
            "scope": "own_bank_debits",
            "start": start,
            "end": end,
            "freshness": observation_freshness(observed, as_of, self.max_age) if as_of else {},
        }
