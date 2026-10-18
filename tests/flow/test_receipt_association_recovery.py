from datetime import datetime

from caseproof.adapters.customer_links import CustomerLinks
from caseproof.adapters.provider import Provider
from caseproof.domain.readiness import unresolved_association_receipt_ids
from local_services.bank_network import BankNetwork
from local_services.demo_world import ADMIN
from tests.flow.test_api import client


def test_bound_bank_matched_reply_resolves_payee_transcription_without_erasing_original(tmp_path):
    with client(tmp_path) as c:
        o = c.app.state.orchestrator
        o.s.customer_portal = True
        o.s.llm_provider = "local"
        o.s.external_worker = True
        o.s.trail_feed_path = tmp_path / "feed.json"
        o.llm = Provider(o.s)
        network = BankNetwork(o)
        manifest = network.create("PAYEE-RECOVERY", 791, ADMIN)
        txs = network.read(manifest["network_id"], ADMIN)["dataset"]["transactions"][2:4]
        tx = txs[0]
        s = o.store.create(
            "PAYEE-RECOVERY",
            customer_account=manifest["customer_account"],
            reported_at=manifest["reported_at"],
            first_contact=manifest["first_contact"],
            selected_transaction_ids=[t["txn_id"] for t in txs],
        )
        o.intake.add(
            s.case_id,
            b"A caller pretended to be bank support and asked me to transfer to a safe account.",
            "text/plain",
            "narrative",
        )
        date = datetime.fromisoformat(tx["ts"])

        def receipt(payee):
            return (
                f"INR {tx['amount_minor'] / 100:.2f}\nDate: {date:%Y-%m-%d}\n"
                f"Time: {date:%H:%M} IST\nTo: {payee}\n"
            ).encode()

        original = o.intake.add(
            s.case_id, receipt("misread." + tx["payee"]), "text/plain", "receipt"
        )
        aid = original.artifacts[-1].artifact_id
        old_hash = original.artifacts[-1].sha256
        blocked = o.process(s.case_id)
        assert unresolved_association_receipt_ids(blocked) == {aid}
        request = next(r for r in blocked.requests if r.state == "proposed")
        assert request.catalogue_id == "identify_receipt_payment"
        assert "receipt_association" in request.explanation["can_settle"]
        links = CustomerLinks(o)
        token = links.issue(s.case_id, request.request_id)["url"].rsplit("/", 1)[1]
        links.upload(token, receipt(tx["payee"]), "text/plain", "receipt")
        pending = o.process(s.case_id)
        assert "receipt_association" in pending.readiness.unresolved_facts
        links.complete(token)
        ready = o.process(s.case_id)
        assert not unresolved_association_receipt_ids(ready)
        assert "receipt_association" not in ready.readiness.unresolved_facts
        assert ready.readiness.disposition == "COMPLETE_CANDIDATE"
        assert any(a.artifact_id == aid and a.sha256 == old_hash for a in ready.artifacts)
        assert any(c.confidence_note.startswith("receipt_unassociated:") for c in ready.claims)
        assert o.store.get(s.case_id, blocked.revision).digest == blocked.digest
        assert o.store.get(s.case_id, blocked.revision).valid_digest()
        for mutation in (
            "unbound",
            "multiple",
            "no_bank_match",
            "same_original",
            "wrong_stage",
            "wrong_reference",
        ):
            invalid = ready.model_copy(deep=True)
            req = next(r for r in invalid.requests if r.request_id == request.request_id)
            reply_id = req.explanation["replacement_artifact_ids"][0]
            if mutation == "unbound":
                req.explanation["receipt_artifact_ids"] = []
            if mutation == "multiple":
                req.explanation["receipt_artifact_ids"].append("OTHER")
            if mutation == "no_bank_match":
                invalid.ledger_matches = []
            if mutation == "same_original":
                req.explanation["replacement_artifact_ids"] = [aid]
            if mutation == "wrong_stage":
                next(a for a in invalid.artifacts if a.artifact_id == reply_id).stage = "initial"
            if mutation == "wrong_reference":
                from caseproof.domain.contracts import CandidateClaim

                anchor = next(seg.segment_id for seg in invalid.segments if seg.artifact_id == aid)
                invalid.claims.append(
                    CandidateClaim(
                        claim_id="different-reference",
                        kind="transaction_reference",
                        normalized_value="DIFFERENT-REF",
                        anchor_segment_ids=[anchor],
                    )
                )
            assert aid in unresolved_association_receipt_ids(invalid), mutation
