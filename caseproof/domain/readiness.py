from typing import Any

from caseproof.domain.contracts import ReadinessAssessment


def receipt_claims(snapshot):
    """Group receipt observations without using another artifact's text."""
    receipts = {a.artifact_id for a in snapshot.artifacts if a.kind == "receipt"}
    by_segment = {s.segment_id: s for s in snapshot.segments}
    return {
        aid: [
            c
            for c in snapshot.claims
            if c.anchor_segment_ids
            and all(
                anchor in by_segment and by_segment[anchor].artifact_id == aid
                for anchor in c.anchor_segment_ids
            )
        ]
        for aid in receipts
    }


def unreadable_receipt_ids(snapshot):
    """Readability is distinct from whether a readable value matches bank data."""
    from caseproof.domain.money_text import AMBIGUOUS_AMOUNT

    observed = {s.artifact_id for s in snapshot.segments}
    return {
        aid
        for aid, claims in receipt_claims(snapshot).items()
        if aid not in observed
        or not any(
            c.kind == "amount"
            and c.normalized_value is not None
            and (
                c.evidence_state != "unresolved"
                or c.confidence_note.startswith("receipt_unassociated:")
            )
            for c in claims
        )
        or any(
            c.kind == "amount"
            and c.normalized_value is None
            and c.confidence_note == AMBIGUOUS_AMOUNT
            for c in claims
        )
    }


def unresolved_receipt_ids(snapshot):
    # Old originals remain immutable. A reply must either share a corroborated
    # payment reference or be bound to the single original requested by the server.
    from caseproof.domain.validator import normalized

    grouped = receipt_claims(snapshot)
    unreadable = unreadable_receipt_ids(snapshot)
    artifacts = {a.artifact_id: a for a in snapshot.artifacts}
    unresolved = set()
    for aid in unreadable:
        claims = grouped[aid]
        refs = {
            normalized(c.normalized_value)
            for c in claims
            if c.kind == "transaction_reference"
            and c.evidence_state in {"source_supported", "reported"}
        }
        # A partial receipt with a unique bank-corroborated reference does not
        # justify asking the victim again for an amount the bank already knows.
        # A present but ambiguous/invalid amount remains a separate evidence gap.
        reference_matches = [
            m
            for m in snapshot.ledger_matches
            if normalized(m.resolved_fields.get("transaction_reference", "")) in refs
            and m.resolved_fields.get("amount") is not None
        ]
        settled = (
            len(refs) == 1
            and len(reference_matches) == 1
            and not any(c.kind == "amount" for c in claims)
        )
        for other, replacement in grouped.items():
            if other == aid or other in unreadable:
                continue
            good = [c for c in replacement if c.evidence_state in {"source_supported", "reported"}]
            other_refs = {
                normalized(c.normalized_value) for c in good if c.kind == "transaction_reference"
            }
            amounts = {c.normalized_value for c in good if c.kind == "amount"}
            if any(
                normalized(m.resolved_fields.get("transaction_reference", "")) in refs & other_refs
                and m.resolved_fields.get("amount") in amounts
                for m in snapshot.ledger_matches
            ):
                settled = True
                break
        if not settled:
            for request in snapshot.requests:
                targets = request.explanation.get("receipt_artifact_ids", [])
                replies = request.explanation.get("replacement_artifact_ids", [])
                reply_refs = {
                    normalized(c.normalized_value)
                    for replacement_id in replies
                    for c in grouped.get(replacement_id, [])
                    if c.kind == "transaction_reference"
                    and c.evidence_state in {"source_supported", "reported"}
                }
                if (
                    request.catalogue_id == "request_readable_receipt"
                    and request.state == "fulfilled"
                    and targets == [aid]
                    and len(replies) == 1
                    and replies[0] in grouped
                    and replies[0] not in unreadable
                    and artifacts[replies[0]].stage == "followup"
                    and replies[0] != aid
                    and (not refs or refs == reply_refs)
                ):
                    settled = True
                    break
        if not settled:
            unresolved.add(aid)
    return unresolved


def unresolved_association_receipt_ids(snapshot):
    """Resolve an OCR association gap only through a bound, bank-matched replacement.

    Retain the original claims/markers. A selected debit or unrelated upload is
    insufficient, as is a replacement with no independent receipt claim match.
    """
    from caseproof.domain.validator import normalized

    grouped = receipt_claims(snapshot)
    artifacts = {a.artifact_id: a for a in snapshot.artifacts}
    unresolved = {
        aid
        for aid, claims in grouped.items()
        if any(c.confidence_note.startswith("receipt_unassociated:") for c in claims)
    }
    for request in snapshot.requests:
        targets = request.explanation.get("receipt_artifact_ids", [])
        replies = request.explanation.get("replacement_artifact_ids", [])
        if (
            request.catalogue_id not in {"request_readable_receipt", "identify_receipt_payment"}
            or request.state != "fulfilled"
            or len(targets) != 1
            or targets[0] not in unresolved
            or len(replies) != 1
            or replies[0] == targets[0]
            or replies[0] not in artifacts
            or artifacts[replies[0]].kind != "receipt"
            or artifacts[replies[0]].stage != "followup"
        ):
            continue
        original = grouped[targets[0]]
        replacement = grouped.get(replies[0], [])
        if any(c.evidence_state in {"unresolved", "conflicted"} for c in replacement):
            continue
        refs = {
            normalized(c.normalized_value) for c in original if c.kind == "transaction_reference"
        }
        reply_refs = {
            normalized(c.normalized_value) for c in replacement if c.kind == "transaction_reference"
        }
        if refs and refs != reply_refs:
            continue
        # All three identifying observations must come from this replacement,
        # and must participate in the same scoped ledger match.
        if any(
            all(
                any(c.kind == kind and c.claim_id in match.claim_ids for c in replacement)
                for kind in ("amount", "txn_datetime", "payee_vpa")
            )
            for match in snapshot.ledger_matches
        ):
            unresolved.remove(targets[0])
    return unresolved


def receipt_replacement_target_ids(snapshot, catalogue_id):
    if catalogue_id == "identify_receipt_payment":
        return unresolved_association_receipt_ids(snapshot)
    return unresolved_receipt_ids(snapshot)


def needs_readable_receipt(snapshot):
    return bool(unresolved_receipt_ids(snapshot))


def satisfied(snapshot: Any) -> Any:
    """Decide whether validated claims and ledger rows settle a required fact."""
    cs = [c for c in snapshot.claims if c.evidence_state == "source_supported"]
    facts = {"date" if c.kind == "txn_datetime" else c.kind for c in cs}
    # This fact records the customer's account of deception, never proves deception occurred.
    if any(
        c.kind == "scam_instruction" and c.evidence_state in ("reported", "source_supported")
        for c in snapshot.claims
    ):
        facts.add("deception_account")
    for m in snapshot.ledger_matches:
        facts.update("date" if k == "txn_datetime" else k for k in m.resolved_fields)
    verification = snapshot.trail.get("bank_verification", {})
    if snapshot.ledger_matches:
        facts.add("bank_verified")
    if verification.get("complete"):
        facts.add("ledger_coverage")
    if snapshot.ledger_matches and not snapshot.unreported:
        facts.add("all_transfers_accounted")
    return facts


def assess_readiness(snapshot: Any, policy: Any) -> Any:
    """Compute complete, review, or escalation readiness without an LLM."""
    facts = satisfied(snapshot)
    required = set(
        policy["required_facts"] + ["bank_verified", "ledger_coverage", "all_transfers_accounted"]
    )
    if needs_readable_receipt(snapshot):
        required.add("readable_receipt")
    conflicts = [
        c.claim_id for c in snapshot.claims if c.materiality and c.evidence_state == "conflicted"
    ]
    missing = required - facts
    if unresolved_association_receipt_ids(snapshot):
        missing.add("receipt_association")
    unavailable = any(
        r.state == "unavailable"
        and r.reason.strip()
        and any(
            g.gap_id in r.resolves_gap_ids and g.required_fact in missing for g in snapshot.gaps
        )
        for r in snapshot.requests
    )
    disposition = (
        "ESCALATE_CANDIDATE"
        if unavailable
        else "COMPLETE_CANDIDATE"
        if not missing and not conflicts
        else "REVIEW_REQUIRED"
    )
    return ReadinessAssessment(
        disposition=disposition,
        satisfied_facts=sorted(facts),
        unresolved_facts=sorted(missing),
        blocking_conflicts=conflicts,
        policy_version=policy["version"],
    )
