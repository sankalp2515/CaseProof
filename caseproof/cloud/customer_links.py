"""Case-scoped expiring capabilities with transactional upload counts and replies."""

import hashlib
import secrets
import time
import uuid

from caseproof.adapters.sqlite_casestore import ConflictError
from caseproof.domain.contracts import ArtifactRef, CaseSnapshot
from caseproof.domain.readiness import receipt_replacement_target_ids
from caseproof.domain.requests import blocked


class CustomerLinks:
    def __init__(self, o):
        self.o, self.docs = o, o.store.documents

    def resolve(self, token, tx=None):
        if not self.o.s.customer_portal or len(token) != 43:
            raise PermissionError("invalid or expired upload link")
        digest = hashlib.sha256(token.encode()).hexdigest()
        reader = tx or self.docs
        row = reader.get("customer_links/" + digest)
        if not row or row["used"] or row["expires"] <= time.time():
            raise PermissionError("invalid or expired upload link")
        case = reader.get(self.o.store.case_path(row["case_id"]))
        if case.get("active_links", {}).get(row["request_id"] or "initial") != digest:
            raise PermissionError("superseded upload link")
        return row

    def issue(self, cid, request_id=None, expires_in=3600):
        if not self.o.s.customer_portal or not 60 <= expires_in <= 86400:
            raise ValueError("customer portal disabled or invalid link lifetime")
        token, expiry = secrets.token_urlsafe(32), time.time() + expires_in
        digest = hashlib.sha256(token.encode()).hexdigest()

        def commit(tx):
            case = tx.get(self.o.store.case_path(cid))
            snap = CaseSnapshot.model_validate_json(
                tx.get(self.o.store.revision_path(cid, case["revision"]))["data"]
            )
            if request_id:
                proposed = [r for r in snap.requests if r.state == "proposed"]
                accepted = [r for r in snap.requests if r.state == "accepted"]
                chosen = next((r for r in snap.requests if r.request_id == request_id), None)
                if (
                    not chosen
                    or chosen.state not in {"proposed", "accepted"}
                    or blocked(chosen.reason)
                    or any(r.request_id != request_id for r in accepted)
                    or chosen.state == "proposed"
                    and (not proposed or proposed[0].request_id != request_id)
                ):
                    raise ValueError("send only the highest ranked outstanding request")
                chosen.state = "accepted"
                if chosen.catalogue_id in {"request_readable_receipt", "identify_receipt_payment"}:
                    chosen.explanation.setdefault(
                        "receipt_artifact_ids",
                        sorted(receipt_replacement_target_ids(snap, chosen.catalogue_id)),
                    )
                    chosen.explanation.setdefault("replacement_artifact_ids", [])
            case.setdefault("active_links", {})[request_id or "initial"] = digest
            snap.revision += 1
            self.o.store.write_snapshot(tx, case, snap, "customer_link_issued")
            tx.set(
                "customer_links/" + digest,
                {
                    "token_hash": digest,
                    "case_id": cid,
                    "request_id": request_id,
                    "expires": expiry,
                    "used": False,
                    "uploads": 0,
                },
                create=True,
            )
            if request_id:
                tx.set(
                    "victim_inbox/" + hashlib.sha256((cid + request_id).encode()).hexdigest(),
                    {
                        "case_id": cid,
                        "request_id": request_id,
                        "url": self.o.s.public_base_url.rstrip("/") + "/customer/" + token,
                        "expires": expiry,
                    },
                )
            return snap.revision

        revision = self.docs.transact(commit)
        return {
            "url": self.o.s.public_base_url.rstrip("/") + "/customer/" + token,
            "expires_at": expiry,
            "revision": revision,
            "delivery": "simulated_sms_link" if request_id else "customer_upload_link",
            "synthetic": True,
        }

    def upload(self, token, data, mime, kind):
        self.resolve(token)
        key, digest = self.o.storage.put(data, mime)
        aid = "ART-" + uuid.uuid4().hex[:12]

        def commit(tx):
            row = self.resolve(token, tx)
            case = tx.get(self.o.store.case_path(row["case_id"]))
            snap = CaseSnapshot.model_validate_json(
                tx.get(self.o.store.revision_path(row["case_id"], case["revision"]))["data"]
            )
            if any(a.sha256 == digest for a in snap.artifacts):
                return
            if (
                row["uploads"] >= 4
                or len(snap.artifacts) >= 6
                or sum(a.byte_count for a in snap.artifacts) + len(data) > 20 * 1024 * 1024
            ):
                raise ValueError("upload link or case limit")
            snap.artifacts.append(
                ArtifactRef(
                    artifact_id=aid,
                    case_id=snap.case_id,
                    kind=kind,
                    mime_type=mime,
                    sha256=digest,
                    byte_count=len(data),
                    object_key=key,
                    stage="followup" if row["request_id"] else "initial",
                )
            )
            request = next((r for r in snap.requests if r.request_id == row["request_id"]), None)
            if (
                request
                and request.state == "accepted"
                and request.catalogue_id in {"request_readable_receipt", "identify_receipt_payment"}
                and kind == "receipt"
            ):
                request.explanation.setdefault("replacement_artifact_ids", []).append(aid)
            snap.revision += 1
            snap.readiness.disposition = "REVIEW_REQUIRED"
            self.o.store.write_snapshot(tx, case, snap, "artifact_added")
            row["uploads"] += 1
            tx.set("customer_links/" + row["token_hash"], row)

        self.docs.transact(commit)
        return {"uploaded": True}

    def complete(self, token, notes="", unavailable=False):
        if len(notes) > 10000 or unavailable and not notes.strip():
            raise ValueError("bounded response reason required")
        if notes.strip():
            self.upload(token, notes.encode(), "text/plain", "narrative")

        def commit(tx):
            row = self.resolve(token, tx)
            if not row["uploads"]:
                raise ValueError("upload evidence or provide a response")
            case = tx.get(self.o.store.case_path(row["case_id"]))
            snap = CaseSnapshot.model_validate_json(
                tx.get(self.o.store.revision_path(row["case_id"], case["revision"]))["data"]
            )
            if row["request_id"]:
                request = next(
                    (r for r in snap.requests if r.request_id == row["request_id"]), None
                )
                if not request or request.state != "accepted":
                    raise ConflictError("request_no_longer_outstanding")
                request.state = "unavailable" if unavailable else "fulfilled"
                if notes.strip():
                    request.reason = notes.strip()
            snap.revision += 1
            snap.readiness.disposition = "REVIEW_REQUIRED"
            self.o.store.write_snapshot(tx, case, snap, "request_fulfilled")
            row["used"] = True
            tx.set("customer_links/" + row["token_hash"], row)
            jid = self.o.store.job_write(tx, case, snap.revision, 10)
            return {"received": True, "job_id": jid, "revision": snap.revision}

        return self.docs.transact(commit)

    def describe(self, token):
        row = self.resolve(token)
        request = next(
            (
                r
                for r in self.o.store.get(row["case_id"]).requests
                if r.request_id == row["request_id"]
            ),
            None,
        )
        return {
            "request": request.reason if request else "Upload evidence for your complaint",
            "case_id": row["case_id"],
            "uploads": row["uploads"],
            "expires_at": row["expires"],
            "synthetic": True,
            "reminder": "Report on 1930 / cybercrime.gov.in now; don't wait for this request",
        }
