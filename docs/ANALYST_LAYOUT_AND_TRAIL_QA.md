# Analyst layout and Money Trail QA

## Design corrections

The accepted reference is the original Studio Money Trail and the supplied account-graph screenshot. The existing Inter / Source Serif 4 / monospace typography, ivory workspace, white cards, blue actions and restrained borders are retained.

| Observed problem | Repair |
|---|---|
| Very long brief beside a largely empty right column | Customer-reported details are expandable, identical display values are grouped, and repeated source quotations are removed from Overview. Originals and full claims remain in Evidence. |
| Payments placed below the long brief | Payment inventory now occupies the companion column. Unresolved matters sit with the brief. |
| Recommended-action card repeats the task banner | One primary task banner owns this guidance; detailed reasoning is expandable. |
| Large next-action card on every tab | Smaller typography/padding, concise urgent-referral guidance and a native details control for the explanation. Role-switch controls remain visible. |
| Chronology adds substantial routine scrolling | All chronology events remain available under an expandable section. |
| Inspector squeezes the graph into a narrow column | Money Trail uses the full content width; summary and source inspector follow below. Selecting a node reveals a direct inspector action. |
| Tiny graph labels and node cards | Larger 200×86 cards, reference-derived bank chips, minimum readable default scale and deliberate horizontal panning on narrow screens. |
| Static-looking transfer paths | Animated markers follow actual curved transfer paths, with reduced-motion support. |
| Uniform ordinal slider rather than a transfer timeline | Timestamp-proportional event dots and IST ticks, play/pause and keyboard scrubbing. |
| Main workspace chrome competes with the investigation | More compact laptop header and native full-screen graph view. |

The laptop whitespace had a specific structural cause: the obsolete `overview-grid` class carried a `max-width:1439px` rule that made the last child span the entire grid. Removing that class, rather than merely adjusting gaps, keeps the payment column beside the brief. Browser checks now assert their top/left alignment at laptop and desktop widths.

## Fidelity and data boundaries

Curved connectors, hop columns, account chips, selected-node outline, amount/time edge labels, dashed receiving-report paths and timeline treatment are derived from the reference. Additional **confirmed disputed** debit origins use a distinct red path; unconfirmed candidate payments are not presented as disputed loss.

Account counts and amounts vary with actual case data. Nine accounts and three hops are not hard-coded to imitate the screenshot. Labels describe bank provenance and assessment-time availability rather than inventing verified guilt, a real hold or recovery. Replay highlights the recorded transfer sequence; it does not calculate historical financial allocations or balances in the browser. Backend-supplied positions remain at the assessment time.

The account inspector retains whole-account observation separately from attributed complaint positions. Original source identifiers and observation times remain available. Graph sizing handles branches, merges and cyclic input without discarding transfer records; complex graphs retain zoom and scrolling.

## Verification

The final production build and **87 unit/component tests passed**. New presentation tests cover timestamp-based replay bounds, missing timestamp handling, and retaining nodes/transfers for branches, merges and cycles.

- **85 end-to-end checks passed** on a native local QA stack using the same backend/worker code, literal extraction, supported UTF-8 receipts from actual practice-bank records, the actual bank feed and delivery simulators. Two new complaints reached current-version reviewer approval, readable documents, both destination acknowledgements and persisted follow-up. One denied an additional debit; the other explicitly disputed it, producing the branching trail. No API responses, readiness, allocations or delivery acknowledgements were fabricated.
- **44 final visual/interaction checks passed** at 1242×668, 1440×668, 768×668 and 390×668. Overview, Evidence, Money Trail, Requests and Review were inspected. Checks include the laptop payment-column alignment, contained overflow, compact next-action panel, actual movement of a transfer marker, keyboard scrubbing, debit selection, inspector focus, motion pause/resume and native full-screen entry/exit.
- The end-to-end run included **40 axe scans**; the final visual run included **20 axe scans**. These inspected states reported zero WCAG-tagged axe violations and no uncaught browser errors. This is not a complete screen-reader, language or accessibility certification.

Actual rendered evidence:

| Comparison | Rendered proof |
|---|---|
| Brief and payments align without the legacy blank column | [Laptop Overview](media/analyst-layout/overview-1242.png) |
| Short next-action panel leaves room for investigation | [Evidence](media/analyst-layout/evidence-1242.png), [Requests](media/analyst-layout/requests-1242.png) |
| White, full-width account graph, curved/dashed edges, bank chips and hop columns | [Full-screen Money Trail](media/analyst-layout/trail-fullscreen-1242.png) |
| Real backend branch counts and readable account/edge labels | [Workspace trail](media/analyst-layout/trail-1242.png) |
| Narrow screens retain pan/zoom instead of shrinking the entire graph into illegibility | [Mobile trail](media/analyst-layout/trail-390.png) |

[Test summary](media/analyst-layout/summary.json), [end-to-end results](media/analyst-layout/native-e2e-results.json), [visual results](media/analyst-layout/visual-results.json).

**Open local Docker operational issue:** fresh practice provisioning returned HTTP 504 and a subsequent PNG complaint's processing job failed on the long-running local stack. The isolated API showed unusually high CPU use and Docker operations were delayed. A fresh Docker QA stack subsequently passed actual PNG extraction, source inspection and analyst/request checks, but its customer-reply completion encountered a service-busy error; that Docker end-to-end rerun did **not** pass. Root cause and write-response recovery need separate backend/infrastructure investigation before treating that environment as release-ready. The successful native end-to-end run does not erase these failures.

The native QA launch initially used an incorrect feed-module name; it was corrected to the repository's `local_services.feed:app` before the successful run. That failed launch was test setup, not a product defect. The native QA server uses the supported combined development host, a real external worker and separate native database/ports; it is not the production service topology and did not exercise image OCR.

No financial state, approvals or test-readiness flags were forced to make the workflow pass. Existing Docker volumes were preserved. Only this task's isolated preview API/worker were restarted; other chats' services and the main stack were not restarted. The additional Docker QA project was stopped after testing, with its data retained.

## Preview and rerun

The completed native case is available at [the design preview](http://caseproof-design.localhost:8230/app/#/staff/cases/CASE-8e2f39c20acb976e/trail). Use **Expand money trail** for the reference-style canvas. The distinct hostname keeps preview cookies separate from the earlier 8208 browser session. The native preview processes are recorded under the ignored `var/analyst-density/native/` directory.

From `frontend/`, set `CASEPROOF_BASE_URL`, then use `CASEPROOF_VISUAL_QA=1` with `scripts/analyst-workspace-browser.mjs` for new-complaint workflow checks. `CASEPROOF_TEXT_EVIDENCE=1` selects supported UTF-8 receipts explicitly; its default is off, preserving PNG coverage. `CASEPROOF_REUSE_BANK=1` explicitly selects an existing bank catalogue instead of claiming an empty new practice session. For the read-only case-layout pass, set an accessible `CASEPROOF_CASE_ID` and run `scripts/analyst-visual-browser.mjs`. The full workflow runner creates synthetic complaints and sends to the configured simulators; check the target before running.

Deployment and live cloud provider verification remain outside this change.
