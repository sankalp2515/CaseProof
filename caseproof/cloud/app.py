"""Deployment-held stateless API and private worker; no frontend implementation."""

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from caseproof.adapters.cloud_tasks import CloudTasks, publish_pending
from caseproof.adapters.quarantine_storage import EvidenceNotReady
from caseproof.adapters.sqlite_casestore import ConflictError
from caseproof.cloud.auth import service, staff
from caseproof.cloud.customer_links import CustomerLinks
from caseproof.cloud.observability import install
from caseproof.cloud.runtime import process_job
from caseproof.domain.actions import bank_unavailable, correct, request_state
from caseproof.domain.brief import build_brief
from caseproof.domain.contracts import Actor
from caseproof.domain.evidence import diff
from caseproof.domain.review import approve
from caseproof.pipeline.orchestrator import Orchestrator


class Command(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resource_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,160}$")


class NewCase(BaseModel):
    model_config = ConfigDict(extra="forbid")
    customer_account: str = Field(min_length=1, max_length=100)
    reported_at: str
    first_contact: str | None = None


class Review(BaseModel):
    model_config = ConfigDict(extra="forbid")
    disposition: str = Field(pattern="^(COMPLETE_HANDOFF|ESCALATE_WITH_GAPS)$")
    expected_revision: int = Field(ge=1)
    digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    reason: str = Field(min_length=1, max_length=2000)


class Change(BaseModel):
    expected_revision: int = Field(ge=1)
    reason: str = Field(default="", max_length=2000)
    state: str = ""
    value: str | int | None = None


class Reply(BaseModel):
    notes: str = Field(default="", max_length=10000)
    unavailable: bool = False


class Followup(BaseModel):
    expected_revision: int = Field(ge=1)
    expected_version: int = Field(ge=0)
    owner: str = Field(min_length=1, max_length=120)
    state: str = Field(default="open", pattern="^(open|awaiting_external)$")
    next_action: str = Field(min_length=1, max_length=1000)
    reason: str = Field(min_length=1, max_length=1000)
    due_at: str | None = None


class UrgentReview(BaseModel):
    expected_revision: int = Field(ge=1)
    digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    reason: str = Field(min_length=1, max_length=2000)


def create_app(settings, orchestrator=None, *, worker=False):
    if settings.runtime_backend != "google":
        raise ValueError("Explicit Google runtime required")
    o = orchestrator if orchestrator is not None else Orchestrator(settings)
    app = FastAPI(title="CaseProof Google synthetic backend")
    from caseproof.cloud.body_limit import BodyLimit

    app.add_middleware(BodyLimit)
    app.state.orchestrator = o
    links = CustomerLinks(o)
    install(app)

    def publish_work():
        from caseproof.cloud.observability import emit

        try:
            client = CloudTasks(
                settings.google_cloud_project,
                settings.google_cloud_location,
                settings.cloud_tasks_queue,
                settings.cloud_worker_url,
                settings.cloud_tasks_account,
            )
            publish_pending(o.store.documents, client, limit=20)
        except Exception:
            emit("task_publication_pending_reconciliation", severity="ERROR")

    @app.middleware("http")
    async def publish_after_commit(request, call_next):
        from starlette.background import BackgroundTask

        response = await call_next(request)
        if request.method in {"POST", "PATCH"} and 200 <= response.status_code < 300:
            response.background = BackgroundTask(publish_work)
        return response

    @app.exception_handler(PermissionError)
    async def denied(request, error):
        return JSONResponse({"detail": "access_denied"}, status_code=403)

    @app.exception_handler(ConflictError)
    async def conflict(request, error):
        return JSONResponse({"detail": str(error)}, status_code=409)

    @app.exception_handler(KeyError)
    async def missing(request, error):
        return JSONResponse({"detail": "resource_not_found"}, status_code=404)

    from caseproof.adapters.firestore_casestore import CaseLimitError

    @app.exception_handler(CaseLimitError)
    async def case_limit(request, error):
        return JSONResponse({"detail": str(error)}, status_code=429)

    @app.exception_handler(ValueError)
    async def invalid(request, error):
        return JSONResponse({"detail": "invalid_request_or_state"}, status_code=422)

    @app.exception_handler(EvidenceNotReady)
    async def scan_pending(request, error):
        return JSONResponse({"detail": "evidence_scan_pending_or_rejected"}, status_code=503)

    @app.get("/health")
    def health():
        return {
            "ok": True,
            "service": "caseproof-cloud-worker" if worker else "caseproof-cloud-api",
            "synthetic": True,
            "mode": "cloud",
            "provider": "vertex+documentai",
            "deployment_verified": False,
        }

    if worker:

        def tasks_identity(authorization: str | None = Header(default=None)):
            return service(settings, authorization, settings.cloud_tasks_account)

        def scheduler_identity(authorization: str | None = Header(default=None)):
            return service(settings, authorization, settings.cloud_scheduler_account)

        @app.post("/internal/tasks/process")
        def process(body: Command, actor=Depends(tasks_identity)):
            return process_job(o, body.resource_id)

        @app.post("/internal/tasks/scan")
        def scan(body: Command, actor=Depends(tasks_identity)):
            return o.storage.scan(body.resource_id)

        @app.post("/internal/tasks/bank_publish")
        def bank_publish(body: Command, actor=Depends(tasks_identity)):
            return o.bank_ingestion.publish(body.resource_id)

        @app.post("/internal/tasks/outbound")
        def dispatch(body: Command, actor=Depends(tasks_identity)):
            from caseproof.cloud.outbound import dispatch

            return dispatch(o, body.resource_id)

        @app.post("/internal/reconcile")
        def reconcile(actor=Depends(scheduler_identity)):
            from caseproof.cloud.reconcile import reconcile

            return reconcile(o)

        return app

    def identity(
        request: Request,
        authorization: str | None = Header(default=None),
        x_demo_user: str | None = Header(default=None),
    ):
        if not authorization and settings.cloud_practice_personas and settings.demo_mode:
            return practice_persona(request, x_demo_user)
        actor = staff(settings, authorization)
        if request.cookies.get("cp_demo") and actor.tenant_id == "demo":
            actor = actor.model_copy(
                update={"tenant_id": app.state.cloud_catalogue(request)["tenant"]}
            )
        return actor

    def practice_persona(request, persona):
        """Labelled synthetic persona, scoped to the caller's own practice tenant only."""
        if persona not in {"analyst", "reviewer"}:
            raise PermissionError("authenticated_identity_required")
        if not request.cookies.get("cp_demo"):
            raise HTTPException(401, "practice_session_required")
        tenant = app.state.cloud_catalogue(request)["tenant"]
        if not tenant.startswith("judge-"):
            raise PermissionError("practice_session_required")
        return Actor(user_id="practice-" + persona, role=persona, tenant_id=tenant)

    def authorised(cid, actor):
        if o.store.metadata(cid)["tenant_id"] != actor.tenant_id:
            raise PermissionError("tenant mismatch")

    def mutation(actor):
        if actor.role not in {"analyst", "admin"}:
            raise PermissionError("analyst required")

    def administrator(actor):
        if actor.role != "admin" or not settings.demo_mode:
            raise PermissionError("synthetic administrator required")

    @app.post("/v1/admin/synthetic/preload")
    def preload(actor=Depends(identity)):
        from caseproof.adapters.firestore_casestore import identity as key
        from caseproof.cloud.bank_network import CloudBankNetwork

        administrator(actor)
        catalogue = CloudBankNetwork(o).seed_tenant(actor)
        o.store.documents.transact(
            lambda tx: tx.set(
                "demo_catalogues/" + key(actor.tenant_id),
                {"tenant": actor.tenant_id, "catalogue": catalogue},
            )
        )
        return {"synthetic": True, "state": "bank_data_preparing", "catalogue": catalogue}

    @app.post("/v1/admin/synthetic/networks/{network_id}/refresh")
    def refresh(network_id: str, actor=Depends(identity)):
        from caseproof.cloud.bank_network import CloudBankNetwork

        administrator(actor)
        return CloudBankNetwork(o).publish_reports(network_id, actor, refresh=True)

    @app.get("/v1/workspace")
    def workspace(actor=Depends(identity)):
        from caseproof.api.workspace import workspace

        return workspace(o.store, actor.tenant_id)

    @app.post("/v1/cases")
    def create(body: NewCase, actor=Depends(identity)):
        from caseproof.adapters.bank_factory import bank_services
        from caseproof.domain.ledger import dt

        mutation(actor)
        bank, _ = bank_services(o, actor.tenant_id)
        bank.check_account(body.customer_account, actor.tenant_id)
        dt(body.reported_at)
        if body.first_contact:
            dt(body.first_contact)
        return o.store.create(tenant_id=actor.tenant_id, **body.model_dump())

    @app.get("/v1/cases/{cid}")
    def snapshot(cid: str, actor=Depends(identity)):
        authorised(cid, actor)
        return o.store.get(cid)

    @app.get("/v1/cases/{cid}/workflow")
    def workflow(cid: str, actor=Depends(identity)):
        from caseproof.api.workspace import workspace

        authorised(cid, actor)
        return workspace(o.store, actor.tenant_id, cid)["cases"][0]

    @app.get("/v1/cases/{cid}/brief")
    def brief(cid: str, actor=Depends(identity)):
        authorised(cid, actor)
        snap = o.store.get(cid)
        return build_brief(snap, o.store.approval(cid, snap.revision))

    @app.get("/v1/cases/{cid}/genai/summary")
    def genai_summary(cid: str, revision: int | None = None, actor=Depends(identity)):
        from caseproof.genai import case_summary

        authorised(cid, actor)
        snap = o.store.get(cid, revision)
        return case_summary(o, snap, build_brief(snap, o.store.approval(cid, snap.revision)))

    @app.post("/v1/cases/{cid}/genai/investigate")
    def genai_investigate(cid: str, actor=Depends(identity)):
        from caseproof.adapters.bank_factory import bank_services
        from caseproof.genai import investigate

        authorised(cid, actor)
        snap, meta = o.store.get(cid), o.store.metadata(cid)
        bank = bank_services(o, meta["tenant_id"])[0]
        bank.exclude_case_id = cid
        if snap.clock:
            bank.observation_as_of = snap.clock.as_of
        return investigate(
            o, snap, bank, meta.get("customer_account", ""), meta.get("reported_at", "")
        )

    @app.get("/v1/cases/{cid}/artifacts/{aid}/genai-read")
    def genai_read(cid: str, aid: str, actor=Depends(identity)):
        from caseproof.genai import read_evidence

        authorised(cid, actor)
        snap = o.store.get(cid)
        item = next((a for a in snap.artifacts if a.artifact_id == aid), None)
        if not item:
            raise KeyError("artifact not found")
        if not item.mime_type.startswith("image/"):
            return {"available": False, "reason": "not_an_image"}
        return read_evidence(o, snap, item, o.storage.read(item.object_key))

    @app.get("/v1/cases/{cid}/report-preview")
    def preview(cid: str, actor=Depends(identity)):
        from caseproof.domain.report_update import receipt_debits

        authorised(cid, actor)
        snap = o.store.get(cid)
        return {
            "revision": snap.revision,
            "digest": snap.digest,
            "requires_approval": True,
            "ledger_debits": [m.model_dump() for m in snap.ledger_matches],
            "unreported": [u.model_dump() for u in snap.unreported],
            "evidence_only_debits": receipt_debits(snap),
            "trail": snap.trail,
            "clock": snap.clock.model_dump() if snap.clock else None,
        }

    @app.post("/v1/cases/{cid}/followup")
    def followup(cid: str, body: Followup, actor=Depends(identity)):
        from caseproof.domain.ownership import assign

        authorised(cid, actor)
        return assign(o.store, cid, actor, body)

    @app.get("/v1/cases/{cid}/urgent-referrals")
    def referrals(cid: str, actor=Depends(identity)):
        from caseproof.cloud.referral import history

        authorised(cid, actor)
        return history(o.store, cid)

    @app.post("/v1/cases/{cid}/urgent-referrals")
    def urgent_review(cid: str, body: UrgentReview, actor=Depends(identity)):
        from caseproof.cloud.referral import approve as approve_urgent

        authorised(cid, actor)
        return approve_urgent(o, cid, actor, body.expected_revision, body.digest, body.reason)

    @app.post("/v1/cases/{cid}/urgent-referrals/{aid}/send")
    def urgent_send(cid: str, aid: str, actor=Depends(identity)):
        from caseproof.cloud.referral import send

        authorised(cid, actor)
        return send(o, cid, aid, actor)

    @app.post("/v1/cases/{cid}/artifacts")
    async def upload(
        cid: str, file: UploadFile = File(...), kind: str = Form(...), actor=Depends(identity)
    ):
        authorised(cid, actor)
        mutation(actor)
        data = await file.read(5 * 1024 * 1024 + 1)
        return o.intake.add(cid, data, file.content_type, kind)

    @app.get("/v1/cases/{cid}/artifacts/{aid}/content")
    def artifact(cid: str, aid: str, actor=Depends(identity)):
        authorised(cid, actor)
        item = next((a for a in o.store.get(cid).artifacts if a.artifact_id == aid), None)
        if not item:
            raise KeyError("artifact not found")
        return Response(
            o.storage.read(item.object_key),
            media_type=item.mime_type,
            headers={"Content-Disposition": "attachment"},
        )

    @app.post("/v1/cases/{cid}/process")
    def enqueue(cid: str, actor=Depends(identity)):
        authorised(cid, actor)
        mutation(actor)
        snap = o.store.get(cid)
        return {"job_id": o.jobs.enqueue(cid, snap.revision, 10)}

    @app.get("/v1/jobs/{jid}")
    def job(jid: str, actor=Depends(identity)):
        row = o.jobs.get(jid)
        authorised(row["case_id"], actor)
        return row

    @app.post("/v1/jobs/{jid}/retry")
    def retry(jid: str, actor=Depends(identity)):
        authorised(o.jobs.get(jid)["case_id"], actor)
        mutation(actor)
        return o.jobs.retry(jid)

    @app.post("/v1/cases/{cid}/reviews")
    def review(cid: str, body: Review, actor=Depends(identity)):
        authorised(cid, actor)
        return approve(
            o.store, cid, actor, body.expected_revision, body.digest, body.disposition, body.reason
        )

    @app.get("/v1/cases/{cid}/approvals")
    def approvals(cid: str, actor=Depends(identity)):
        authorised(cid, actor)
        return o.store.approval_history(cid)

    @app.get("/v1/cases/{cid}/audit")
    def audit(cid: str, actor=Depends(identity)):
        authorised(cid, actor)
        return o.store.audit(cid)

    @app.post("/v1/cases/{cid}/exports")
    def export(cid: str, actor=Depends(identity)):
        from caseproof.cloud.outbound import prepare

        authorised(cid, actor)
        if actor.role not in {"reviewer", "admin"}:
            raise PermissionError("reviewer required")
        packet = prepare(o, cid)
        return {"packet": packet.model_dump(mode="json"), "outbound": [], "queued": True}

    @app.get("/v1/ui-config")
    def frontend_config():
        from caseproof.api.ui_views import ui_config

        return ui_config()

    @app.get("/v1/cases/{cid}/delivered-packets/{pid}")
    def delivered(cid: str, pid: str, actor=Depends(identity)):
        from caseproof.cloud.outbound import delivered_packet

        authorised(cid, actor)
        return delivered_packet(o.store, cid, pid)

    @app.get("/v1/cases/{cid}/delivered-packets/{pid}/document")
    def handoff_document(cid: str, pid: str, actor=Depends(identity)):
        from fastapi.responses import HTMLResponse

        from caseproof.domain.handoff_document import render_document

        packet = delivered(cid, pid, actor)
        return HTMLResponse(
            render_document(packet),
            headers={
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Content-Disposition": 'attachment; filename="caseproof-handoff.html"',
            },
        )

    @app.post("/v1/cases/{cid}/upload-links")
    def issue(cid: str, actor=Depends(identity)):
        authorised(cid, actor)
        mutation(actor)
        return links.issue(cid)

    @app.post("/v1/cases/{cid}/requests/{rid}/send")
    def send_request(cid: str, rid: str, actor=Depends(identity)):
        authorised(cid, actor)
        mutation(actor)
        return links.issue(cid, rid)

    @app.post("/v1/cases/{cid}/requests/{rid}/response")
    def request_response(cid: str, rid: str, body: Change, actor=Depends(identity)):
        authorised(cid, actor)
        mutation(actor)
        return request_state(o, cid, rid, body.state, body.reason, body.expected_revision)

    @app.patch("/v1/cases/{cid}/claims/{claim_id}")
    def correction(cid: str, claim_id: str, body: Change, actor=Depends(identity)):
        authorised(cid, actor)
        mutation(actor)
        return correct(o, cid, claim_id, body.value, body.reason, body.expected_revision)

    @app.post("/v1/cases/{cid}/bank-verification/unavailable")
    def verification_unavailable(cid: str, body: Change, actor=Depends(identity)):
        authorised(cid, actor)
        mutation(actor)
        return bank_unavailable(o, cid, body.reason, body.expected_revision)

    @app.get("/v1/cases/{cid}/revisions/{a}/diff/{b}")
    def revisions(cid: str, a: int, b: int, actor=Depends(identity)):
        authorised(cid, actor)
        return diff(o.store.get(cid, a), o.store.get(cid, b))

    @app.get("/v1/customer/{token}")
    def link(token: str):
        return links.describe(token)

    @app.post("/v1/customer/{token}/artifacts")
    async def reply_upload(token: str, file: UploadFile = File(...), kind: str = Form(...)):
        return links.upload(token, await file.read(5 * 1024 * 1024 + 1), file.content_type, kind)

    @app.post("/v1/customer/{token}/complete")
    def complete(token: str, body: Reply):
        return links.complete(token, body.notes, body.unavailable)

    from caseproof.cloud.victim import install as install_victim

    install_victim(app, o)
    return app
