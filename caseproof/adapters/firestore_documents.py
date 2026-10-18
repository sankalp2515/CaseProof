"""Native Firestore REST documents and bounded optimistic transactions."""

import copy
import math
import re
import time

from caseproof.adapters.google_http import authorized_session


def encode(value):
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        if not -(2**63) <= value < 2**63:
            raise ValueError("Firestore integer out of range")
        return {"integerValue": str(value)}
    if isinstance(value, float) and math.isfinite(value):
        return {"doubleValue": value}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [encode(v) for v in value]}}
    if isinstance(value, dict) and all(isinstance(k, str) for k in value):
        return {"mapValue": {"fields": {k: encode(v) for k, v in value.items()}}}
    raise ValueError("Unsupported Firestore value")


def decode(value):
    for key, item in value.items():
        if key == "nullValue":
            return None
        if key == "integerValue":
            return int(item)
        if key in {"booleanValue", "doubleValue", "stringValue", "timestampValue"}:
            return item
        if key == "arrayValue":
            return [decode(v) for v in item.get("values", [])]
        if key == "mapValue":
            return {k: decode(v) for k, v in item.get("fields", {}).items()}
    raise ValueError("Unsupported Firestore response")


class FirestoreDocuments:
    def __init__(self, project, namespace, *, database="(default)", session=None):
        if not re.fullmatch(r"[a-z][a-z0-9-]{4,61}[a-z0-9]", project or ""):
            raise ValueError("Explicit Google project required")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", namespace or "") or database != "(default)":
            raise ValueError("Explicit isolated Firestore namespace/default database required")
        self.base = (
            f"https://firestore.googleapis.com/v1/projects/{project}/databases/{database}/documents"
        )
        self.root = f"projects/{project}/databases/{database}/documents/environments/{namespace}"
        self.url = "https://firestore.googleapis.com/v1/" + self.root
        self.session = session if session is not None else authorized_session()

    def name(self, path):
        if not re.fullmatch(r"[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)+", path):
            raise ValueError("Invalid document path")
        return self.root + "/" + path

    def get(self, path, transaction=None):
        name = self.name(path)
        response = self.session.get(
            "https://firestore.googleapis.com/v1/" + name,
            params={"transaction": transaction} if transaction else {},
            timeout=20,
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return {k: decode(v) for k, v in response.json().get("fields", {}).items()}

    def query(self, collection, filters=(), limit=100, *, lower_bound=None):
        if not re.fullmatch(r"[A-Za-z0-9_-]+", collection) or not 1 <= limit <= 500:
            raise ValueError("Bounded collection query required")
        query = {"from": [{"collectionId": collection}], "limit": limit}
        clauses = [
            {
                "fieldFilter": {
                    "field": {"fieldPath": field},
                    "op": "EQUAL",
                    "value": encode(value),
                }
            }
            for field, value in filters
        ]
        if lower_bound is not None:
            field, value = lower_bound
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*", field):
                raise ValueError("Invalid query field")
            clauses.append(
                {
                    "fieldFilter": {
                        "field": {"fieldPath": field},
                        "op": "GREATER_THAN_OR_EQUAL",
                        "value": encode(value),
                    }
                }
            )
            query["orderBy"] = [{"field": {"fieldPath": field}, "direction": "DESCENDING"}]
        if clauses:
            query["where"] = (
                clauses[0]
                if len(clauses) == 1
                else {"compositeFilter": {"op": "AND", "filters": clauses}}
            )
        response = self.session.post(
            self.url + ":runQuery", json={"structuredQuery": query}, timeout=20
        )
        response.raise_for_status()
        return [
            {k: decode(v) for k, v in row["document"].get("fields", {}).items()}
            for row in response.json()
            if "document" in row
        ]

    def transact(self, operation):
        for attempt in range(4):
            response = self.session.post(self.base + ":beginTransaction", json={}, timeout=20)
            response.raise_for_status()
            token = response.json()["transaction"]
            tx = Transaction(self, token)
            try:
                result = operation(tx)
                response = self.session.post(
                    self.base + ":commit",
                    json={"transaction": token, "writes": tx.writes},
                    timeout=20,
                )
                if response.status_code == 409 and attempt < 3:
                    time.sleep(0.02 * 2**attempt)
                    continue
                response.raise_for_status()
                return result
            except Exception:
                try:
                    self.session.post(
                        self.base + ":rollback", json={"transaction": token}, timeout=10
                    )
                except Exception:
                    pass
                raise
        raise RuntimeError("Firestore transaction retry exhausted")


class Transaction:
    def __init__(self, documents, token):
        self.documents, self.token, self.writes = documents, token, []
        self.pending = {}

    def get(self, path):
        if path in self.pending:
            return copy.deepcopy(self.pending[path])
        return self.documents.get(path, self.token)

    def set(self, path, value, *, create=False):
        from caseproof.domain.contracts import canonical

        fields = {k: encode(v) for k, v in value.items()}
        # Reject predictably before Firestore's 1 MiB document/10 MiB request limits.
        if len(canonical(fields).encode()) > 850_000 or len(self.writes) >= 100:
            raise ValueError("cloud_transaction_size_limit")
        write = {"update": {"name": self.documents.name(path), "fields": fields}}
        if create:
            write["currentDocument"] = {"exists": False}
        old = next((w for w in self.writes if w["update"]["name"] == write["update"]["name"]), None)
        if old:
            if create:
                raise ValueError("duplicate create in transaction")
            if old.get("currentDocument"):
                write["currentDocument"] = old["currentDocument"]
            self.writes.remove(old)
        self.writes.append(write)
        if len(canonical(self.writes).encode()) > 8_000_000:
            raise ValueError("cloud_transaction_size_limit")
        self.pending[path] = copy.deepcopy(value)
