import re
from typing import Any

from caseproof.domain.contracts import EvidenceRequest

BLOCKED = re.compile(
    (
        "\\b(?:OTP|PIN|password|CVV)\\b|full[ _]+(?:device|screen|cha"
        "t)[ _]+(?:access|history)|unrelated[ _]+ID[ _]+document|ir"
        "relevant[ _]+national[ _]+ID"
    ),
    re.I,
)


def blocked(text: Any) -> bool:
    """Detect prohibited customer requests using the deterministic safety guard."""
    return bool(BLOCKED.search(text))


def score(c: Any) -> int:
    """Score a permitted request using policy weights and clock urgency."""
    return 3 * c["R"] + 2 * c["C"] + c["U"] + c["A"] - 2 * c["E"] - 3 * c["P"]


def select_requests(gaps: Any, history: Any, policy: Any, urgency_value: Any = 0) -> Any:
    """Rank catalogue requests and suppress facts already settled by evidence."""
    out = []
    for entry in policy["catalogue"]:
        matching = [g for g in gaps if g.required_fact in entry["facts"]]
        if not matching:
            continue
        prior = next(
            (
                r
                for r in reversed(history)
                if r.catalogue_id == entry["catalogue_id"]
                and r.state in ("unavailable", "accepted", "fulfilled", "skipped")
            ),
            None,
        )
        if prior and prior.state != "fulfilled":
            continue
        state = (
            "blocked"
            if blocked(entry["text"])
            else "suppressed"
            if all(g.resolvable_by == "ledger" for g in matching)
            else "proposed"
        )
        if state == "proposed" and not any(g.resolvable_by == "customer" for g in matching):
            continue
        components = dict(entry["components"])
        components["U"] = urgency_value * entry.get("urgency_weight", 1)
        conflicting = any(g.status == "conflicting" for g in matching)
        if not conflicting:
            components["C"] = 0
        if conflicting and "conflict_relevance" in entry:
            components["R"] = entry["conflict_relevance"]
        out.append(
            EvidenceRequest(
                request_id="REQ-"
                + entry["catalogue_id"]
                + (
                    "-retry-" + str(sum(r.catalogue_id == entry["catalogue_id"] for r in history))
                    if any(r.catalogue_id == entry["catalogue_id"] for r in history)
                    else ""
                ),
                catalogue_id=entry["catalogue_id"],
                resolves_gap_ids=[g.gap_id for g in matching],
                score=score(components),
                score_components=components,
                state=state,
                reason="unsafe request"
                if state == "blocked"
                else "bank record has it"
                if state == "suppressed"
                else entry["text"],
                explanation={
                    "urgency_basis": [
                        f"Urgency {urgency_value} × catalogue weight "
                        f"{entry.get('urgency_weight', 1)}"
                    ],
                    "can_settle": [g.required_fact for g in matching],
                    "cannot_prove": ["Caller identity, guilt, liability, or recovery"],
                    "priority_reason": [
                        (
                            "Resolve conflicting or unreadable evidence"
                            if conflicting
                            or any(
                                g.required_fact in {"readable_receipt", "receipt_association"}
                                for g in matching
                            )
                            else "Confirm bank-discovered debit before narrative clarification"
                            if any(g.required_fact == "all_transfers_accounted" for g in matching)
                            else "Resolve the highest-scored remaining customer evidence gap"
                        )
                    ],
                },
            )
        )
    out.sort(
        key=lambda r: (
            r.state != "proposed",
            0
            if "Resolve conflicting or unreadable evidence" in r.explanation["priority_reason"]
            else 1
            if r.catalogue_id == "confirm_additional_transfer"
            else 2,
            -r.score,
            r.score_components.get("P", 0),
            r.score_components.get("E", 0),
            r.catalogue_id,
        )
    )
    return list(history) + [
        r for r in out if not any(h.request_id == r.request_id for h in history)
    ]
