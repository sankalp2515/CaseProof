"""Deterministic analyst findings. A source observation is never proof of guilt/recovery."""


def readable_brief(brief):
    action = brief["recommended_action"]
    lines = [
        brief["title"],
        f"Case: {brief['case_id']} / revision {brief['revision']}",
        brief["summary"],
        "",
        "NEXT ACTION",
        action["action"],
        "Owner: " + action["owner"],
        action["reason"],
        "",
        "PAYMENT INVENTORY",
    ]
    for p in brief["payments"]:
        amount = (
            f"INR {p['amount_minor'] / 100:,.2f}" if p.get("amount_minor") else "Not established"
        )
        lines.append(f"- {p['txn_id']}: {amount}; {p['status']}; source {p['source_id']}")
    for heading, key in [("VICTIM STATEMENTS", "victim_statements"), ("CONFLICTS", "conflicts")]:
        lines += ["", heading]
        for c in brief[key]:
            lines.append(f"- {c['kind']}: {c['value']} ({c['state']})")
            if c.get("note"):
                lines.append("  Note: " + c["note"])
            for src in c["sources"]:
                lines.append(f"  [{src['segment_id']}] {src['text']}")
        if not brief[key]:
            lines.append("None recorded.")
    lines += ["", "CHRONOLOGY"]
    for t in brief["chronology"]:
        lines.append(
            f"- {t['at'] or 'Time unknown'}: {t['event']}; {t['source_category']}; {t['source_id']}"
        )
    lines += ["", "BANK COVERAGE"]
    bank = brief["own_bank_verification"]
    lines.append(
        f"Complete: {bank.get('complete', False)}; observed: {bank.get('observed_at', 'unknown')}"
    )
    lines += ["", "DOWNSTREAM OBSERVATIONS"]
    for r in brief["downstream_observations"]:
        lines.append(
            f"- {r.get('bank', 'Bank unknown')} / {r['account']}: "
            f"INR {r['balance_minor'] / 100:,.2f}; "
            f"observed {r.get('reported_at')}; {r['update_id']}"
        )
    lines += ["", "UNKNOWNS"] + ["- " + x for x in brief["unknowns"]]
    a = brief["approval"]
    lines += [
        "",
        "APPROVAL",
        f"{a['reviewer']['user_id']}: {a['reason']} ({a['at']})"
        if a
        else "No approval recorded for this revision.",
        "",
        brief["limitations"],
    ]
    return "\n".join(lines)


DISPOSITION_TEXT = {
    "REVIEW_REQUIRED": "needs analyst review",
    "COMPLETE_CANDIDATE": "ready for reviewer sign-off",
    "ESCALATE_CANDIDATE": "should be escalated now",
}


def plain_summary(snapshot, confirmed):
    matched, extra = len(snapshot.ledger_matches), len(snapshot.unreported)
    text = (
        f"Our bank records confirm {matched} disputed payment{'s' if matched != 1 else ''} "
        f"totalling INR {confirmed / 100:,.2f}."
        if matched
        else "No disputed payment is confirmed in our bank records yet."
    )
    if extra:
        text += f" {extra} more payment{'s' if extra != 1 else ''} to confirm with the customer."
    status = DISPOSITION_TEXT.get(snapshot.readiness.disposition, "is under review")
    return text + f" The case {status}."


def build_brief(snapshot, approval=None):
    by_segment = {s.segment_id: s for s in snapshot.segments}
    artifacts = {a.artifact_id: a for a in snapshot.artifacts}
    statements, conflicts = [], []
    for c in snapshot.claims:
        if c.kind == "embedded_instruction":
            continue
        sources = [
            {
                **by_segment[s].model_dump(),
                "received_at": artifacts[by_segment[s].artifact_id].received_at
                if by_segment[s].artifact_id in artifacts
                else None,
            }
            for s in c.anchor_segment_ids
            if s in by_segment
        ]
        row = {
            "claim_id": c.claim_id,
            "kind": c.kind,
            "value": c.normalized_value,
            "state": c.evidence_state,
            "source_category": "victim",
            "sources": sources,
            "note": c.confidence_note,
        }
        if c.evidence_state == "conflicted":
            conflicts.append(row)
        elif c.evidence_state != "unresolved" and sources:
            statements.append(row)
    payments = []
    timeline = [
        {
            "at": a.received_at,
            "event": "Evidence received",
            "source_category": "victim",
            "source_id": a.artifact_id,
        }
        for a in snapshot.artifacts
    ]
    for m in snapshot.ledger_matches:
        f = m.resolved_fields
        payments.append(
            {
                "txn_id": m.txn_id,
                "status": "confirmed_disputed",
                "amount_minor": f.get("amount"),
                "at": f.get("txn_datetime"),
                "reference": f.get("transaction_reference"),
                "payee": f.get("payee_vpa"),
                "source_category": "own_bank",
                "source_id": "ledger:" + m.txn_id,
            }
        )
        timeline.append(
            {
                "at": f.get("txn_datetime"),
                "event": "Disputed bank debit",
                "source_category": "own_bank",
                "source_id": "ledger:" + m.txn_id,
            }
        )
    for u in snapshot.unreported:
        payments.append(
            {
                "txn_id": u.txn_id,
                "status": "awaiting_confirmation",
                "amount_minor": u.amount_minor,
                "at": u.ts,
                "reference": u.reference,
                "payee": u.payee,
                "source_category": "own_bank",
                "source_id": "ledger:" + u.txn_id,
            }
        )
    for d in snapshot.trail.get("victim_payment_decisions", []):
        timeline.append(
            {
                "at": d.get("at"),
                "event": "Victim confirmed payment" if d["disputed"] else "Victim denied payment",
                "source_category": "victim",
                "source_id": "decision:" + d["transaction_id"],
            }
        )
        if not d["disputed"]:
            payments.append(
                {
                    "txn_id": d["transaction_id"],
                    "status": "denied",
                    "amount_minor": None,
                    "source_category": "victim",
                    "source_id": "decision:" + d["transaction_id"],
                }
            )
    downstream = [
        {**r, "source_category": "downstream_bank"}
        for r in snapshot.trail.get("account_observations", [])
    ]
    for r in downstream:
        timeline.append(
            {
                "at": r.get("reported_at"),
                "event": "Downstream bank observation",
                "source_category": "downstream_bank",
                "source_id": r["update_id"],
            }
        )
    proposed = next((r for r in snapshot.requests if r.state == "proposed"), None)
    missing = list(snapshot.readiness.unresolved_facts)
    if conflicts:
        action = {
            "owner": "fraud_analyst",
            "action": "Resolve material evidence conflicts",
            "reason": "Conflicting statements cannot be accepted as verified facts.",
        }
    elif proposed:
        action = {
            "owner": "fraud_analyst",
            "action": "Request missing customer information",
            "request_id": proposed.request_id,
            "reason": proposed.reason,
        }
    elif any(g.resolvable_by == "ledger" and g.required_fact in missing for g in snapshot.gaps):
        action = {
            "owner": "bank_data_operations",
            "action": "Obtain complete fresh bank coverage",
            "reason": "Bank records must be obtained internally, not requested from the victim.",
        }
    elif snapshot.readiness.disposition in {"COMPLETE_CANDIDATE", "ESCALATE_CANDIDATE"}:
        action = {
            "owner": "reviewer",
            "action": "Review the supported handoff or escalation",
            "reason": "Readiness permits human review; it is not a fraud or liability finding.",
        }
    else:
        action = {
            "owner": "fraud_analyst",
            "action": "Review unresolved evidence",
            "reason": "The available evidence does not settle all required information.",
        }
    if approval:
        timeline.append(
            {
                "at": approval.at,
                "event": "Reviewer approved this revision",
                "source_category": "human_decision",
                "source_id": approval.approval_id,
            }
        )
    confirmed = sum(p["amount_minor"] or 0 for p in payments if p["status"] == "confirmed_disputed")
    candidate = sum(
        p["amount_minor"] or 0 for p in payments if p["status"] == "awaiting_confirmation"
    )

    def chronology_key(row):
        from datetime import datetime

        return (
            datetime.fromisoformat(row["at"]).timestamp() if row["at"] else float("inf"),
            row["source_id"],
        )

    return {
        "version": "brief-v1",
        "case_id": snapshot.case_id,
        "revision": snapshot.revision,
        "digest": snapshot.digest,
        "title": "Investigation brief",
        "summary": plain_summary(snapshot, confirmed),
        "totals": {"confirmed_disputed_minor": confirmed, "candidate_minor": candidate},
        "victim_statements": statements,
        "payments": payments,
        "own_bank_verification": snapshot.trail.get("bank_verification", {}),
        "downstream_observations": downstream,
        "chronology": sorted(timeline, key=chronology_key),
        "conflicts": conflicts,
        "unknowns": missing,
        "recommended_action": action,
        "approval": approval.model_dump(mode="json") if approval else None,
        "providers": [r.model_dump() for r in snapshot.run_meta],
        "limitations": "Advisory synthetic assessment. Reported statements are not proof of "
        "identity or guilt. Observed funds are not recovered, frozen or refunded.",
    }
