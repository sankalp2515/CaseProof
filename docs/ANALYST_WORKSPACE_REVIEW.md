# Analyst workspace review and local acceptance

18 October 2026. Branch: `codex/victim-experience`. Preview: http://127.0.0.1:8208/app/ . Deployment is on hold. Main's committed application fixes were merged into this independent worktree before this work; main's checkout and services were not changed.

## What the analyst needs first

The analyst needs to establish which payment is disputed, what the evidence actually supports, what is still uncertain, and the next justified action. The previous Overview put the automation explanation and optional investigator above the brief. It also split the payment inventory, large urgency ring and brief into competing columns.

Overview now starts with the current owner/next-action banner. The main reading column holds the investigation brief, customer statements, payments and chronology. The companion column holds the recommended action, unresolved information and a compact urgency indicator. Optional Gemini assistance follows the primary investigation work. The automation explanation and provider metadata are available in an expandable section.

The visual system is retained: ivory canvas, white cards, blue actions, teal information states, Inter UI text, Source Serif 4 for editorial summaries, and monospace identifiers. Existing borders, radii and control language remain. The new staff stylesheet scopes the layout to case pages, uses consistent card padding/gaps, wraps metadata and stacks columns at smaller widths.

## Concrete reference and usability repairs

| Surface | Repairs |
|---|---|
| Overview | Brief before optional tools; payment inventory in the main reading column; next action in a stable companion column; smaller urgency ring; unresolved items grouped in one card; processing/provider explanation collapsed; delivered cases point to follow-up rather than another review. |
| Evidence | Receipt selected initially where available; facts scoped to the selected file; explicit all-files option; readable source buttons; selected source text visible beside the original; bank amounts formatted from minor units; readable payment times; reviewer read-only explanation; consistent source/fact column alignment. |
| Requests | Primary server-proposed question separated from other assessments; purpose and limits beside it; request history grouped separately; bank-record exception action collapsed; unrelated generic victim-portal shortcut removed; real scoped reply link retained; current-version confirmation before send. |
| Role handoff | Current owner and next action on every case tab; explicit same-case reviewer demo switch when full readiness permits; separate urgent-only reviewer path; approval and delivery remain distinct; processing/stale states block unsupported mutations. |

Before/after images in `docs/media/analyst-workspace/` show actual rendered cases. Different amounts/identifiers reflect independent fresh practice sessions, not hard-coded screenshots or identical case data.

| Screen | Before | After |
|---|---|---|
| Overview | [Before](media/analyst-workspace/overview-before.png) | [After](media/analyst-workspace/overview-after.png) |
| Evidence | [Before](media/analyst-workspace/evidence-before.png) | [After](media/analyst-workspace/evidence-after.png) |
| Requests | [Before](media/analyst-workspace/requests-before.png) | [After](media/analyst-workspace/requests-after.png) |

[Reviewer handoff](media/analyst-workspace/reviewer-handoff.png), [mobile Overview](media/analyst-workspace/overview-mobile.png), and [machine-readable validation](media/analyst-workspace/validation.json).

## What Evidence is for

1. Select the uploaded original (receipt, narrative, chat or other supported artifact).
2. Compare extracted details against the visible source line/image region.
3. Inspect conflicts or extraction errors and, as analyst, submit a supported correction with a reason.
4. Compare the separate bank match and disputed-payment inventory.

“Seen on evidence” means a source contains that detail. It does **not** verify the customer's allegation. “Bank matched” is the separate ledger check. An uploaded receipt, a customer statement, bank verification, and guilt/liability are different things. The UI does not calculate financial allocations, readiness or approval eligibility.

The former “source-linked facts” heading is now **Details extracted from evidence**. Deep-linked citations select the correct original even when source segments arrive after the initial page load. A missing citation in the latest version shows a warning instead of selecting an unrelated source.

## Analyst, reviewer and urgent referral

Both roles need to inspect the brief, originals, trail and history. Analyst owns investigation, supported corrections and customer clarification. Reviewer independently records a disposition/reason against the current revision and digest, then sends the approved packet. Analyst-only mutations are disabled for reviewer; reviewer approval is unavailable to analyst. Backend permissions remain authoritative.

When the server permits full review, the banner offers **Continue as reviewer demo** and preserves the case. In cloud staff authentication, the browser cannot assign roles; these persona switches are confined to the explicit practice profile.

An **urgent transaction referral** can be eligible for an identified disputed bank debit while the full investigation still has gaps. It requires its own reviewer decision. The UI labels this separately and never represents urgent eligibility as completed investigation or full-packet readiness.

## Reusable local test walkthrough

1. Open the preview, choose reporting and start a fresh practice session. Stay in the same browser session.
2. Choose a customer, select the recent scam payment, add an account of what happened and supported evidence, then submit.
3. Use the reporting handoff prompt to enter the analyst workspace. The queue receives the new complaint. Open it.
4. Read the brief, disputed/candidate amounts and current action. In Evidence compare the original with extracted details and the bank match; inspect Money Trail without assuming observed funds are frozen.
5. Open Requests. Inspect the proposed question and why it matters; review and send it. Use its server-issued customer reply link. Reply, upload clarification if appropriate, and complete the response.
6. Return to the case and wait for the actual new assessment/version. Confirm or deny the additional candidate debit through the supported customer flow. Pending jobs are not finished extraction.
7. If there are unresolved facts, continue analyst work. If only urgent referral is eligible, inspect its separate reviewer route. Do not force a full handoff through a blocker.
8. Once full readiness permits, use **Continue as reviewer demo**. Inspect the current report, limitations and version. Enter a meaningful decision reason and approve. Analyst cannot perform this approval.
9. Open Delivery & follow-up, send the approved version and wait for **both** receiver acknowledgements. A queued send alone is insufficient.
10. Inspect the delivered document, set owner and next action, keep `awaiting_external` follow-up, and reload to verify persistence/history.

The 12-stop tour follows this journey and points to the same role banner. It does not pre-approve a case, fabricate a receipt match or bypass unanswered questions.

## Fixed flow edge cases

| Condition | Behaviour |
|---|---|
| Case/proposal changes while send confirmation is open | Compare revision, digest, proposed question and processing state immediately before sending; reload and require reconsideration if changed. |
| Stale load / queued, running or failed processing | Unsupported corrections, request sends and approval/delivery controls are blocked. Supported processing retry stays in Evidence. |
| Reviewer tries analyst actions | Read-only explanation and disabled mutation controls; backend authorization retained. |
| Duplicate approval on the same current version | Current revision/digest approval disables another full approval. Pending urgent approval is also distinguished. |
| Old approval after new evidence | It cannot silently authorize a newer version; delivery rechecks revision, digest and current approval. |
| Delivery partially acknowledged | Both expected receiver kinds are required for the delivered/follow-up presentation. |
| Fractional, unsafe or nonpositive minor-unit correction | Rejected before submission; a reason is still required. |
| AI summary fails | Explicit failure/retry state; ordinary evidence/bank work remains usable. |
| Previous AI summary remains during revision refresh | Its older version is labelled and copying its statement is blocked. Previous-case summary is not carried into another case. |
| Clicking a source before segments finish loading | Citation is selected once its actual source becomes available. |
| Delivered case still carries an assessment recommendation | Overview points to ownership and external follow-up. |

## Validation and evidence

- Production Vite build passed.
- Unit/component suite: **85 passed, 0 failed**. Includes new request-version, selected-source, AI-summary version/retry and staff-journey tests.
- Actual Playwright acceptance: **75 checks passed** across two new complaints, including an uploaded PNG processed by OCR and a supported UTF-8 receipt, actual customer reply, candidate decision, permission boundary, current reviewer approval, both receiver acknowledgements, readable delivered document and persisted follow-up.
- Automated axe: **36 inspected states, zero reported violations** in this acceptance run. Case screens captured at 390, 768, 1280 and 1440px; no body overflow in the inspected layouts. Scrollable tab/document/source regions remain intentional.
- Guided journey regression: **54 checks passed**, five axe scans with zero reported violations, no uncaught browser errors. Includes constrained tour viewports, Back/restart, evidence/review transition and end-to-end delivery.
- Keyboard/focus and dialog checks are included in the existing component/browser coverage. This is not a full assistive-technology audit, certification or proof of accessibility in every possible content state.

Reproduce from `frontend/` with `npm test`, `npm run build`, then `CASEPROOF_BASE_URL=http://127.0.0.1:8208 node scripts/analyst-workspace-browser.mjs` and the existing `scripts/guided-ux.mjs` runner (PowerShell: set `$env:CASEPROOF_BASE_URL` first). They create fresh synthetic complaints and send packets only to the configured local simulators. Inspect the target before running them elsewhere.

## Backend/provider scope and remaining blockers

**This local run:** isolated `caseproof-victim-design` stack on 8208; real worker, Tesseract OCR, literal extraction and bank/feed/receiver simulators. No fabricated API responses. This describes the tested local environment only. The separately deployed application uses Document AI and Vertex AI Gemini; this work neither disables that integration nor claims these local tests revalidated cloud behaviour.

**Backend receipt-recovery update:** the missing recovery path described in the original review is now implemented and tested. A scoped clearer-receipt reply can resolve association only after independent bank corroboration, while preserving the original. See [receipt recovery and full workflow validation](RECEIPT_ASSOCIATION_RECOVERY.md). OCR uncertainty still exists; it is not hidden or fuzzy-matched away.

**Frontend follow-up:** optional on-demand investigator findings still require the analyst to inspect their cited sources; this task does not establish accuracy for every generated finding or all long-content combinations. Automated axe and sampled responsive checks do not replace manual screen-reader/language testing.

**Cloud/launch:** no deployment, live cloud acceptance, DNS, queue/Scheduler, Terraform or launch flags changed. Cloud capacity/rate limits, authenticated role mapping and scheduled bank observations need the separate authorized pre-release pass. No real freeze, refund, regulatory filing or case closure is implied by simulator acknowledgements.


## Golden-hour placement update

The response window now appears in the first task row, before the long Overview content. Desktop places it beside the next-action panel; tablet/mobile puts it first. The duplicate lower card was removed. The server-derived countdown, elapsed/unknown handling, typography, colours and original urgency disclaimer remain unchanged.

Actual browser inspection and Playwright layout checks at 1242×668, 1440×668, 768×668 and 390×668 confirmed the clock fits the first viewport, leads the task row and introduces no body overflow. All four axe scans reported zero violations. Vite build passed. This is a placement change; the earlier full-workflow acceptance and backend results remain documented separately.

[Desktop layout](media/analyst-workspace/golden-hour-top-1242.png), [mobile layout](media/analyst-workspace/golden-hour-top-390.png), [layout checks](media/analyst-workspace/top-window-layout.json).
