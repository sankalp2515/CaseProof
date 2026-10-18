from typing import Any

from caseproof.adapters.bank_factory import bank_services, payment_decisions
from caseproof.domain.contracts import Gap
from caseproof.domain.evidence import merge_conflicts
from caseproof.domain.ledger import find_unreported, match_ledger
from caseproof.domain.linking import find_links
from caseproof.domain.policy import load_policy
from caseproof.domain.readiness import assess_readiness, needs_readable_receipt, satisfied
from caseproof.domain.requests import select_requests


def assess(o: Any, snap: Any, investigate: Any = True) -> Any:
    """Investigate scoped bank evidence and recompute deterministic case decisions."""
    meta = o.store.metadata(snap.case_id)
    policy = load_policy(o.s.policy_path)
    account = meta.get("customer_account", "")
    reported = meta.get("reported_at", "2026-10-01T12:30:00+05:30")
    contact = meta.get("first_contact", reported)
    from datetime import datetime, timezone

    from caseproof.domain.ledger import dt

    replay_as_of = (
        dt(snap.clock.as_of)
        if snap.clock and snap.clock.replay
        else getattr(o, "clock_as_of", None)
    )
    evaluation_at = (replay_as_of or datetime.now(timezone.utc)).isoformat()
    snap.ledger_matches = []
    snap.unreported = []
    snap.linked = []
    if investigate:
        bank, ingestion = bank_services(o, meta["tenant_id"])
        if o.s.runtime_backend == "google":
            bank.exclude_case_id = snap.case_id
            bank.observation_as_of = evaluation_at
        ingestion.check_account(account, meta["tenant_id"])
        prospective = match_ledger(bank, account, snap.claims, evaluation_at)
        independent = (
            {id for m in prospective for id in m.claim_ids} if len(prospective) > 1 else set()
        )
        from caseproof.domain.selected_payments import independent_receipt_claims

        independent.update(
            independent_receipt_claims(snap, bank.transactions(account, evaluation_at))
        )
        merge_conflicts(snap, independent)
        snap.ledger_matches = match_ledger(bank, account, snap.claims, evaluation_at)
        # Customer-selected payments identify disputes; all resolved fields still come
        # from independent scoped bank records, never from the browser's values.
        from caseproof.domain.contracts import LedgerMatch

        decisions, decision_times = payment_decisions(o, snap.case_id)
        selected = set(meta.get("selected_transaction_ids", [])) | {
            k for k, v in decisions.items() if v
        }
        denied = {k for k, v in decisions.items() if not v}
        snap.ledger_matches = [m for m in snap.ledger_matches if m.txn_id not in denied]
        for tx in bank.transactions(account, evaluation_at):
            if tx["txn_id"] in selected - denied and tx["txn_id"] not in {
                m.txn_id for m in snap.ledger_matches
            }:
                snap.ledger_matches.append(
                    LedgerMatch(
                        claim_ids=[],
                        txn_id=tx["txn_id"],
                        match_fields=["customer_selected_bank_transaction"],
                        resolved_fields={
                            "amount": tx["amount_minor"],
                            "currency": "INR",
                            "txn_datetime": tx["ts"],
                            "transaction_reference": tx["reference"],
                            "payee_vpa": tx["payee"],
                        },
                    )
                )
        snap.unreported = find_unreported(
            bank, account, contact, reported, [m.txn_id for m in snap.ledger_matches], evaluation_at
        )
        snap.unreported = [t for t in snap.unreported if t.txn_id not in denied]
        if selected:
            from caseproof.domain.selected_payments import flag_conflicts

            flag_conflicts(snap, bank.transactions(account, evaluation_at), selected - denied)
        snap.linked = find_links(
            bank,
            [
                c.normalized_value
                for c in snap.claims
                if c.kind == "payee_vpa" and c.evidence_state not in ("unresolved", "conflicted")
            ]
            # Bank-confirmed payees of matched debits link repeat complaints even when
            # the customer did not write the UPI ID down.
            + [
                m.resolved_fields["payee_vpa"]
                for m in snap.ledger_matches
                if m.resolved_fields.get("payee_vpa")
            ],
            [
                c.normalized_value
                for c in snap.claims
                if c.kind == "caller_number"
                and c.evidence_state not in ("unresolved", "conflicted")
            ],
            reported,
        )
        if o.s.agentic_investigate:
            from caseproof.adapters.investigation_tools import propose

            calls, run = propose(
                o.llm,
                snap.case_id,
                {
                    "account": account,
                    "payees": [
                        c.normalized_value
                        for c in snap.claims
                        if c.kind == "payee_vpa"
                        and c.evidence_state not in ("unresolved", "conflicted")
                    ],
                },
            )
            for call in calls:
                if call["name"] == "lookup_transactions":
                    bank.transactions(account, evaluation_at)
                elif call["name"] == "find_linked_complaints":
                    find_links(bank, [call["args"]["payee"]], [], reported)
            snap.run_meta.append(run)
    else:
        merge_conflicts(snap)
        # Matched followup transfers count as accounted; confirmation needs a valid
        # amount/time match.
        # Function declarations expose exactly the same authoritative results.
    from caseproof.domain.clock import clock_state, debit_times, urgency
    from caseproof.domain.ledger import dt

    debits = debit_times(snap)
    times = [d["ts"] for d in debits]
    first = min(times, key=dt) if times else None
    snap.clock = clock_state(
        first, dt(evaluation_at), replay=replay_as_of is not None, debits=debits
    )
    if investigate:
        from caseproof.graph.investigate import locate

        locate(o, snap)
        snap.trail["bank_verification"] = ingestion.verification(
            account, meta["tenant_id"], contact, reported, snap.clock.as_of
        )
        if decisions:
            snap.trail["victim_payment_decisions"] = [
                {"transaction_id": k, "disputed": bool(v), "at": decision_times.get(k)}
                for k, v in sorted(decisions.items())
            ]
    else:
        snap.trail = {}
    snap.trail["freshness_policy"] = {
        "max_age_seconds": policy.get("bank_data_max_age_seconds", 900),
        "authority": "synthetic prototype policy",
    }
    snap.trail["debit_clocks"] = [
        {
            **d,
            "clock": clock_state(d["ts"], dt(evaluation_at)).model_dump(),
            "time_status": "future" if dt(d["ts"]) > dt(evaluation_at) else "known",
        }
        for d in debits
    ]
    facts = satisfied(snap)
    gaps = []
    for fact in policy["required_facts"]:
        kind = "txn_datetime" if fact == "date" else fact
        conflict = any(c.kind == kind and c.evidence_state == "conflicted" for c in snap.claims)
        if conflict:
            gaps.append(Gap(gap_id="gap-" + fact, required_fact=fact, status="conflicting"))
        elif fact not in facts:
            gaps.append(Gap(gap_id="gap-" + fact, required_fact=fact))
        elif (
            fact == "transaction_reference"
            and snap.ledger_matches
            and not any(
                c.kind == fact and c.evidence_state == "source_supported" for c in snap.claims
            )
        ):
            gaps.append(Gap(gap_id="gap-" + fact, required_fact=fact, resolvable_by="ledger"))
    if snap.unreported:
        gaps.append(
            Gap(
                gap_id="gap-all_transfers",
                required_fact="all_transfers_accounted",
                status="unconfirmed",
            )
        )
    for fact in ("bank_verified", "ledger_coverage"):
        if fact not in facts:
            gaps.append(Gap(gap_id="gap-" + fact, required_fact=fact, resolvable_by="ledger"))
    if needs_readable_receipt(snap):
        gaps.append(Gap(gap_id="gap-readable", required_fact="readable_receipt"))
    snap.gaps = gaps
    from caseproof.domain.readiness import unresolved_association_receipt_ids

    if unresolved_association_receipt_ids(snap):
        gaps.append(Gap(gap_id="gap-receipt-association", required_fact="receipt_association"))
    history = [
        r
        for r in snap.requests
        if r.state in ("accepted", "fulfilled", "unavailable", "skipped", "blocked", "suppressed")
    ]
    for request in history:
        if request.state == "accepted" and not any(
            g.gap_id in request.resolves_gap_ids and g.resolvable_by == "customer" for g in gaps
        ):
            request.state = "suppressed"
            request.reason = (
                "Resolved by current evidence or bank verification; no response required"
            )
    snap.requests = select_requests(gaps, history, policy, urgency(snap.clock))
    unavailable = next(
        (
            seg.text
            for seg in snap.segments
            if seg.source == "text_line"
            and "unavailable" in seg.text.casefold()
            and any(w in seg.text.casefold() for w in ("because", "lost", "cannot provide"))
        ),
        None,
    )
    if unavailable:
        for r in snap.requests:
            if r.state == "proposed":
                r.state = "unavailable"
                r.reason = unavailable
    snap.readiness = assess_readiness(snap, policy)
    snap.readiness.clock = snap.clock.model_dump()
    if any(
        c.kind == "customer_statement"
        and c.evidence_state != "unresolved"
        and "legitimate" in str(c.normalized_value).casefold()
        and "no deception" in str(c.normalized_value).casefold()
        for c in snap.claims
    ):
        # Routing assessment uses explicit customer denial of deception, not an LLM verdict.
        if any(
            "legitimate" in s.text.casefold() and "no deception" in s.text.casefold()
            for s in snap.segments
        ):
            snap.readiness.disposition = "ESCALATE_CANDIDATE"
            snap.readiness.unresolved_facts.append("outside_scam_scope")
            for r in snap.requests:
                if r.state == "proposed":
                    r.state = "suppressed"
                    r.reason = "Outside scam scope; route the payment query"
    return snap


FUNCTION_DECLARATIONS = [
    {
        "name": "lookup_transactions",
        "description": "Read synthetic transactions for the customer account",
        "parameters": {
            "type": "object",
            "properties": {"account": {"type": "string"}},
            "required": ["account"],
        },
    },
    {
        "name": "find_linked_complaints",
        "description": "Read synthetic complaints sharing payee or caller",
        "parameters": {
            "type": "object",
            "properties": {"payee": {"type": "string"}},
            "required": ["payee"],
        },
    },
]
