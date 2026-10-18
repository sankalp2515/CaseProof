"""Synthetic victim sessions and new complaints using durable cloud records."""

import secrets
import time
from types import SimpleNamespace

from fastapi import Cookie, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field

from caseproof.adapters.bank_factory import bank_services
from caseproof.adapters.firestore_casestore import identity
from caseproof.adapters.sqlite_casestore import ConflictError
from caseproof.api.demo_evidence import SampleEvidence, capabilities, render_sample
from caseproof.api.ui_views import victim_receipt
from caseproof.api.victim import Complaint, PaymentDecision, PracticeScenario, Session
from caseproof.cloud.bank_network import CloudBankNetwork
from caseproof.domain.contracts import CaseSnapshot, hash_json, now


class IntakeDraft(BaseModel):
    narrative: str = Field(min_length=10, max_length=4000)


def install(app, o):
    docs = o.store.documents

    def same_origin(request):
        origin = request.headers.get("origin")
        if origin and origin != o.s.public_base_url.rstrip("/"):
            raise PermissionError("cross-origin victim mutation")

    def session_row(request):
        token = request.cookies.get("cp_demo")
        if not token:
            row = docs.get("demo_catalogues/" + identity("demo"))
        else:
            row = docs.get("demo_sessions/" + hash_json(token))
            if row and row["expires"] <= time.time():
                row = None
        return row

    def catalogue(request):
        row = session_row(request)
        if not row:
            # No practice session in this browser yet (first visit, another browser or
            # an expired cookie): an explicit, actionable state rather than a 503.
            raise HTTPException(401, "practice_session_required")
        return row

    app.state.cloud_catalogue = catalogue

    def customer(request: Request, cp_victim: str | None = Cookie(default=None)):
        if not cp_victim or len(cp_victim) != 43:
            raise PermissionError("victim session required")
        row = docs.get("victim_sessions/" + hash_json(cp_victim))
        if (
            not row
            or row["expires"] <= time.time()
            or row["tenant"] != catalogue(request)["tenant"]
        ):
            raise PermissionError("victim session expired")
        return row

    def owned(cid, person):
        meta = o.store.metadata(cid)
        if (
            meta["tenant_id"] != person["tenant"]
            or meta.get("customer_account") != person["profile"]["account"]
        ):
            raise PermissionError("complaint not owned")

    def bank(person):
        publication = docs.get("bank_publications/" + person["profile"]["publication_id"])
        if not publication or publication["state"] != "published":
            raise HTTPException(503, "bank_data_preparing", headers={"Retry-After": "3"})
        return bank_services(o, person["tenant"])[0]

    def refresh_bank(person):
        """A complaint lies after the session's bank snapshot, so its coverage gap
        ("bank records up to date") would wait for the scheduled refresh. Refresh
        this customer's bank now and publish it directly."""
        from caseproof.adapters.firestore_casestore import identity as key
        from caseproof.cloud.observability import emit

        actor = SimpleNamespace(role="admin", tenant_id=person["tenant"])
        network_id = person["profile"]["network_id"]
        try:
            result = CloudBankNetwork(o).publish_reports(network_id, actor, refresh=True)
            docs.transact(
                lambda tx: tx.set(
                    "feed_refresh/" + key(person["tenant"], network_id), {"at": time.time()}
                )
            )
        except Exception as error:  # noqa: BLE001 - the scheduled refresh still runs
            emit("complaint_bank_refresh_deferred", severity="WARNING", error=type(error).__name__)
            return
        publish_keys(
            [result["bank_publication"]] + [p["publication_id"] for p in result["publications"]]
        )

    def publish_keys(ids):
        from concurrent.futures import ThreadPoolExecutor

        from caseproof.cloud.observability import emit

        def one(key):
            try:
                o.bank_ingestion.publish(key)
            except Exception as error:  # noqa: BLE001 - the queued task retries it
                emit("inline_bank_publish_deferred", severity="WARNING", error=type(error).__name__)

        ids = [i for i in ids if i]
        try:
            o.bank_ingestion.publish_many(ids)
            return
        except Exception as error:  # noqa: BLE001 - fall back to one-by-one
            emit("batched_bank_publish_failed", severity="WARNING", error=type(error).__name__)
        with ThreadPoolExecutor(3) as pool:
            list(pool.map(one, ids))

    def publish_now(generated):
        """Publish the new session's bank batches here, in parallel, instead of
        waiting behind complaint processing in the shared task queue. The queued
        tasks remain as the fallback; publication is idempotent."""
        publish_keys(sorted({c["publication_id"] for c in generated["customers"]}))

    @app.get("/v1/victim/receipts/{txn_id}")
    def receipt(txn_id: str, person=Depends(customer)):
        import json

        transaction = next(
            (
                t
                for t in bank(person).transactions(person["profile"]["account"])
                if t["txn_id"] == txn_id
            ),
            None,
        )
        if not transaction:
            raise PermissionError("payment not owned")
        actor = SimpleNamespace(role="admin", tenant_id=person["tenant"])
        network = CloudBankNetwork(o)
        saved = network.read(person["profile"]["network_id"], actor)
        if transaction["txn_id"] == saved["dataset"]["transactions"][2]["txn_id"]:
            return Response(
                network.receipt(person["profile"]["network_id"], actor), media_type="image/png"
            )
        return Response(json.dumps(transaction, indent=2).encode(), media_type="text/plain")

    @app.get("/v1/victim/demo-customers")
    def people(request: Request):
        row = session_row(request)
        if not row:
            return {"synthetic": True, "session": False, "customers": []}
        return {**row["catalogue"], "session": True}

    @app.post("/v1/victim/demo-session")
    def new_session(request: Request, response: Response, body: PracticeScenario | None = None):
        same_origin(request)
        scenario = body or PracticeScenario()
        from datetime import datetime, timezone

        day = datetime.now(timezone.utc).date().isoformat()

        def reserve(tx):
            path = "demo_limits/sessions-" + day
            limit = tx.get(path) or {"count": 0}
            if limit["count"] >= o.s.cloud_practice_daily_limit:
                raise HTTPException(429, "daily_practice_session_limit")
            limit["count"] += 1
            tx.set(path, limit)

        docs.transact(reserve)
        token = secrets.token_urlsafe(32)
        tenant = "judge-" + hash_json(token)[:12]
        generated = CloudBankNetwork(o).seed_tenant(
            SimpleNamespace(role="admin", tenant_id=tenant),
            minutes_ago=scenario.minutes_ago,
            seeds=[secrets.randbelow(9000) + 1000 for _ in range(6)],
        )

        def create(tx):
            tx.set(
                "demo_sessions/" + hash_json(token),
                {"tenant": tenant, "expires": time.time() + 86400, "catalogue": generated},
                create=True,
            )

        docs.transact(create)
        publish_now(generated)
        response.set_cookie(
            "cp_demo", token, secure=True, httponly=True, samesite="strict", max_age=86400
        )
        response.delete_cookie("cp_victim", secure=True, httponly=True, samesite="strict")
        return {
            "session_id": tenant,
            "synthetic": True,
            "complaints_created": 0,
            "bank_data_preparing": True,
        }

    @app.get("/v1/victim/demo-session/progress")
    def build_progress(request: Request):
        """How many of this session's synthetic bank batches BigQuery has published."""
        row = session_row(request)
        if not row:
            raise HTTPException(401, "practice_session_required")
        ids = sorted(
            {c["publication_id"] for c in row["catalogue"]["customers"] if c.get("publication_id")}
        )
        published = sum(
            1 for i in ids if (docs.get("bank_publications/" + i) or {}).get("state") == "published"
        )
        return {"total": len(ids), "published": published, "ready": published == len(ids)}

    @app.post("/v1/victim/sessions")
    def login(body: Session, request: Request, response: Response):
        same_origin(request)
        chosen = catalogue(request)
        profile = next(
            (p for p in chosen["catalogue"]["customers"] if p["account"] == body.customer_id), None
        )
        if profile is None:
            raise PermissionError("unknown customer")
        token = secrets.token_urlsafe(32)
        docs.transact(
            lambda tx: tx.set(
                "victim_sessions/" + hash_json(token),
                {"profile": profile, "tenant": chosen["tenant"], "expires": time.time() + 86400},
                create=True,
            )
        )
        response.set_cookie(
            "cp_victim", token, secure=True, httponly=True, samesite="strict", max_age=86400
        )
        return {"synthetic": True}

    @app.post("/v1/victim/intake-assist")
    def intake(body: IntakeDraft, request: Request, person=Depends(customer)):
        from caseproof.genai import intake_assist

        same_origin(request)
        return intake_assist(o, person["tenant"], body.narrative)

    @app.get("/v1/victim/sample-evidence")
    def sample_capabilities(person=Depends(customer)):
        return capabilities(o)

    @app.post("/v1/victim/sample-evidence")
    def sample_evidence(body: SampleEvidence, request: Request, person=Depends(customer)):
        same_origin(request)
        transaction = next(
            (
                t
                for t in bank(person).transactions(person["profile"]["account"])
                if t["txn_id"] == body.transaction_id
            ),
            None,
        )
        if transaction is None:
            raise PermissionError("payment not owned")
        image, generator = render_sample(o, person["profile"]["account"], transaction, body)
        return Response(image, media_type="image/png", headers={"X-CaseProof-Generator": generator})

    @app.get("/v1/victim/me")
    def me(person=Depends(customer)):
        return {
            "customer": person["profile"],
            "transactions": bank(person).transactions(person["profile"]["account"]),
            "complaints": o.store.cases_for_accounts(
                person["tenant"], {person["profile"]["account"]}
            ),
            "demo_time": now(),
        }

    @app.post("/v1/victim/complaints")
    def submit(body: Complaint, request: Request, person=Depends(customer)):
        same_origin(request)
        transactions = {
            t["txn_id"]: t for t in bank(person).transactions(person["profile"]["account"])
        }
        if any(tid not in transactions for tid in body.transaction_ids):
            raise PermissionError("payment not owned")
        cid = (
            "CASE-"
            + identity(person["tenant"], person["profile"]["account"], body.submission_id)[:16]
        )
        if body.first_contact:
            from caseproof.domain.ledger import dt

            dt(body.first_contact)
        digest = hash_json(body.model_dump())
        meta = dict(
            customer_account=person["profile"]["account"],
            reported_at=now(),
            first_contact=body.first_contact
            or min((transactions[t]["ts"] for t in body.transaction_ids), default=now()),
            contact_time_unknown=body.first_contact is None,
            channel="bank_website",
            selected_transaction_ids=list(dict.fromkeys(body.transaction_ids)),
            submission_digest=digest,
            payment_authorisation=body.payment_authorisation,
            complaint_references={
                "bank": body.bank_reference,
                "ncrp": body.ncrp_reference,
                "fir": body.fir_reference,
            },
        )
        try:
            o.store.create(cid, tenant_id=person["tenant"], **meta)
        except ConflictError:
            if o.store.metadata(cid).get("submission_digest") != digest:
                raise ConflictError("submission_content_changed") from None
        from caseproof.domain.intake_priority import record_intake_priority

        record_intake_priority(o, cid, [transactions[t] for t in body.transaction_ids])
        o.intake.add(cid, body.narrative.encode(), "text/plain", "narrative")
        snap = o.store.get(cid)
        o.jobs.enqueue(cid, snap.revision, priority=10)
        refresh_bank(person)
        return {"case_id": cid, "bank_reference": "CEDAR-" + cid[5:], "synthetic": True}

    @app.get("/v1/victim/complaints/{cid}")
    def complaint(cid: str, person=Depends(customer)):
        owned(cid, person)
        snap = o.store.get(cid)
        messages = []
        for item in snap.requests:
            if item.state == "accepted":
                import hashlib

                row = docs.get(
                    "victim_inbox/" + hashlib.sha256((cid + item.request_id).encode()).hexdigest()
                )
                messages.append(
                    {
                        "request_id": item.request_id,
                        "text": item.reason,
                        "reply_url": row["url"] if row and row["expires"] > time.time() else None,
                    }
                )
        delivered = any(
            r["status"] == "sent" for r in docs.query("outbox", [("case_id", cid)], limit=100)
        )
        return {
            "case_id": cid,
            "status": "Information requested"
            if messages
            else "Report update available"
            if delivered
            else "Being reviewed",
            "messages": messages,
            "evidence_count": len(snap.artifacts),
            "candidate_payments": [t.model_dump() for t in snap.unreported],
            "note": "A report acknowledgement does not mean money is held or recovered.",
            **victim_receipt(o, cid, snap),
        }

    @app.post("/v1/victim/complaints/{cid}/artifacts")
    async def upload(
        cid: str,
        request: Request,
        file: UploadFile = File(...),
        kind: str = Form(...),
        person=Depends(customer),
    ):
        same_origin(request)
        owned(cid, person)
        return o.intake.add(cid, await file.read(5 * 1024 * 1024 + 1), file.content_type, kind)

    @app.post("/v1/victim/complaints/{cid}/submit")
    def finish(cid: str, request: Request, person=Depends(customer)):
        same_origin(request)
        owned(cid, person)
        snap = o.store.get(cid)
        return {"job_id": o.jobs.enqueue(cid, snap.revision, 10), "revision": snap.revision}

    @app.post("/v1/victim/complaints/{cid}/payments")
    def decision(cid: str, body: PaymentDecision, request: Request, person=Depends(customer)):
        same_origin(request)
        owned(cid, person)
        if body.transaction_id not in {
            t["txn_id"] for t in bank(person).transactions(person["profile"]["account"])
        }:
            raise PermissionError("payment not owned")

        def record(tx):
            case = tx.get(o.store.case_path(cid))
            prior = case["decisions"].get(body.transaction_id)
            if prior:
                if prior["disputed"] != body.disputed:
                    raise ConflictError("immutable_payment_decision")
                return {"recorded": True, "duplicate": True}
            snap = CaseSnapshot.model_validate_json(
                tx.get(o.store.revision_path(cid, case["revision"]))["data"]
            )
            if body.transaction_id not in {t.txn_id for t in snap.unreported}:
                raise ValueError("payment is not a current candidate")
            case["decisions"][body.transaction_id] = {"disputed": body.disputed, "at": now()}
            snap.revision += 1
            snap.readiness.disposition = "REVIEW_REQUIRED"
            o.store.write_snapshot(tx, case, snap, "victim_payment_decision")
            return {"recorded": True, "revision": snap.revision}

        return docs.transact(record)
