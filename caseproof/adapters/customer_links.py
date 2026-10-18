"""Expiring case-scoped bearer links; store only token hashes and audit transitions."""

import hashlib
import secrets
import time

from filelock import FileLock
from sqlalchemy import text

from caseproof.domain.actions import request_state


class CustomerLinks:
    def __init__(self, orchestrator):
        self.o = orchestrator
        with self.o.store.engine.begin() as db:
            db.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS customer_links("
                    "token_hash TEXT PRIMARY KEY,case_id TEXT,request_id TEXT,expires REAL,"
                    "used INTEGER DEFAULT 0,uploads INTEGER DEFAULT 0)"
                )
            )

    def lock(self, case_id):
        directory = self.o.s.data_dir / "case_locks"
        directory.mkdir(parents=True, exist_ok=True)
        return FileLock(str(directory / (hashlib.sha256(case_id.encode()).hexdigest() + ".lock")))

    def resolve(self, token):
        if not self.o.s.customer_portal:
            raise PermissionError("customer portal disabled")
        if len(token) != 43:
            raise PermissionError("invalid or expired upload link")
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.o.store.engine.connect() as db:
            row = (
                db.execute(
                    text("SELECT * FROM customer_links WHERE token_hash=:token"), {"token": digest}
                )
                .mappings()
                .first()
            )
        if not row or row["used"] or row["expires"] <= time.time():
            raise PermissionError("invalid or expired upload link")
        return dict(row)

    def issue(self, case_id, request_id=None, expires_in=3600):
        if not 60 <= expires_in <= 86400:
            raise ValueError("invalid link lifetime")
        with self.lock(case_id):
            snap = self.o.store.get(case_id)
            if request_id:
                proposed = [r for r in snap.requests if r.state == "proposed"]
                accepted = [r for r in snap.requests if r.state == "accepted"]
                chosen = next((r for r in snap.requests if r.request_id == request_id), None)
                if not chosen or chosen.state not in {"proposed", "accepted"}:
                    raise ValueError("request cannot be sent")
                if accepted and any(r.request_id != request_id for r in accepted):
                    raise ValueError("one customer request is already outstanding")
                if chosen.state == "proposed":
                    if not proposed or proposed[0].request_id != request_id:
                        raise ValueError("send only the highest ranked request")
                    snap = request_state(self.o, case_id, request_id, "accepted")
            old = snap.revision
            if request_id:
                chosen = next(r for r in snap.requests if r.request_id == request_id)
                if chosen.catalogue_id in {"request_readable_receipt", "identify_receipt_payment"}:
                    from caseproof.domain.readiness import receipt_replacement_target_ids

                    chosen.explanation.setdefault(
                        "receipt_artifact_ids",
                        sorted(receipt_replacement_target_ids(snap, chosen.catalogue_id)),
                    )
                    chosen.explanation.setdefault("replacement_artifact_ids", [])
            snap.revision += 1
            self.o.store.publish(snap, old, "customer_link_issued")
            token = secrets.token_urlsafe(32)
            expiry = time.time() + expires_in
            with self.o.store.engine.begin() as db:
                db.execute(
                    text(
                        "UPDATE customer_links SET used=1 WHERE case_id=:id "
                        "AND request_id IS :request AND used=0"
                    ),
                    {"id": case_id, "request": request_id},
                )
                db.execute(
                    text(
                        "INSERT INTO customer_links(token_hash,case_id,request_id,expires) "
                        "VALUES(:token,:id,:request,:expires)"
                    ),
                    {
                        "token": hashlib.sha256(token.encode()).hexdigest(),
                        "id": case_id,
                        "request": request_id,
                        "expires": expiry,
                    },
                )
            return {
                "url": self.o.s.public_base_url.rstrip("/") + "/customer/" + token,
                "expires_at": expiry,
                "revision": snap.revision,
                "delivery": "simulated_sms_link" if request_id else "customer_upload_link",
                "synthetic": True,
            }

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
            "reminder": "Report on 1930 / cybercrime.gov.in now; don't wait for this request",
            "synthetic": True,
        }

    def upload(self, token, data, mime, kind):
        row = self.resolve(token)
        with self.lock(row["case_id"]):
            row = self.resolve(token)
            if row["uploads"] >= 4:
                raise ValueError("upload link file limit")
            current = self.o.store.get(row["case_id"])
            self.o.intake.add(
                row["case_id"],
                data,
                mime,
                kind,
                stage="followup" if row["request_id"] else "initial",
                expected_revision=current.revision,
                receipt_request_id=row["request_id"],
            )
            with self.o.store.engine.begin() as db:
                db.execute(
                    text("UPDATE customer_links SET uploads=uploads+1 WHERE token_hash=:t"),
                    {"t": row["token_hash"]},
                )
        return {"uploaded": True}

    def complete(self, token, notes="", unavailable=False):
        row = self.resolve(token)
        with self.lock(row["case_id"]):
            row = self.resolve(token)
            if len(notes) > 10000 or unavailable and not notes.strip():
                raise ValueError("a bounded unavailable reason is required")
            if not row["uploads"] and not notes.strip():
                raise ValueError("upload evidence or provide a response")
            if notes.strip():
                if row["uploads"] >= 4:
                    raise ValueError("upload link file limit")
                self.o.intake.add(
                    row["case_id"],
                    notes.encode("utf-8"),
                    "text/plain",
                    "narrative",
                    stage="followup" if row["request_id"] else "initial",
                )
                with self.o.store.engine.begin() as db:
                    db.execute(
                        text("UPDATE customer_links SET uploads=uploads+1 WHERE token_hash=:t"),
                        {"t": row["token_hash"]},
                    )
            if row["request_id"]:
                request_state(
                    self.o,
                    row["case_id"],
                    row["request_id"],
                    "unavailable" if unavailable else "fulfilled",
                    notes,
                )
            snapshot = self.o.store.get(row["case_id"])
            job = self.o.jobs.enqueue(row["case_id"], snapshot.revision, priority=10)
            with self.o.store.engine.begin() as db:
                db.execute(
                    text("UPDATE customer_links SET used=1 WHERE token_hash=:t"),
                    {"t": row["token_hash"]},
                )
        return {"received": True, "job_id": job, "revision": snapshot.revision}
