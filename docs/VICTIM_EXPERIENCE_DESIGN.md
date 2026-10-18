# Victim experience redesign

## Baseline and purpose
Created from main d9c37ff in a separate worktree. The audience is a distressed payment-scam victim; the practice audience is a judge exploring an end-to-end report. The goal is accurate reporting and understandable follow-up, not sales conversion. Existing authenticated account boundaries, evidence rules, bank-backed timestamps, worker processing and staff handoff are preserved.

## Research and direction
Official Monzo reporting guidance (https://monzo.com/help/monzo-fraud-category/report-scam) directs an affected customer into their bank app. Revolut guidance (https://help.revolut.com/help/card-payments-withdrawals/paying-by-card-issues/i-don-t-recognise-a-card-payment/i-was-not-supposed-to-be-charged-by-a-specific-merchant/) centres the affected payment and help action. These are adjacent UX references, not a claim of equivalent bank capabilities or an exhaustive competitor benchmark. Our interpretation: begin with recognisable transactions, use plain questions, reveal optional information progressively and make the next action clear. No invented recovery statistics or endorsements.

## Design inventory
- Palette: existing warm ivory #f5f4f0, white #ffffff, ink #15161a, cobalt #2b46d4, teal #0e6d70, slate #626875. Existing semantic statuses preserved.
- Typography: Source Serif 4 editorial headings; Inter forms and navigation; JetBrains Mono for references only.
- Desktop: 260px open support rail, generous gutter, focused report surface. Mobile: single column, no competing rail, visible numbered progress, wrapping payments and accessible actions.
- Components: understated white header, practice identity, vertical support journey, payment rows, explicit multi-select, four-stage progress, evidence upload, report receipt, focused customer reply.
- Motion: 250ms introductory reveal only; reduced-motion opt-out. No artificial processing completion.
- Copy: Payments / What happened / Evidence / Review; Back / Continue / Submit report unchanged. Step-specific titles: Let’s start with the payment. / Your story, in your words. / Add what you have. / Ready when you are.
- Practice setup remains explicitly synthetic. No false secure badges, recovery guarantees, new financial calculations or changed provider configuration.

## Concept and deviations
The generated desktop/mobile concept is a visual exploration, not an application screenshot. Implemented text and controls remain native React. The concept’s single-payment radio control is intentionally corrected to multiple-payment checkboxes, as required by the backend. Live bank values replace illustrative names and amounts. The golden-hour notice belongs to the desktop rail and must also remain discoverable on mobile.

## Verification
Vite production build passed; all 65 frontend tests passed. See [validation results](VICTIM_EXPERIENCE_VALIDATION.json).

| Test run | Passed checks | Accessibility scans | Reported violations |
| --- | ---: | ---: | ---: |
| Two new complaints through real local processing and delivery | 36 | 10 | 0 |
| Focused victim journey and all reporting stages at 320/390/768px | 27 | 26 | 0 |
| Complete guided tour, including narrow/short viewports | 35 | 3 | 0 |
| Genuine customer reply and another complete handoff | 21 | 9 | 0 |

These runs exercised actual image uploads, OCR, worker processing, bank matches, trail rendering, customer clarification, additional-debit decisions, reviewer-only approval, both simulator acknowledgements, the delivered document and persistent follow-up. The focused run also created actual receipt/chat/call-log sample files, checked payment validation and keyboard focus, and opened the exact report as analyst.

The built-in browser was available and used to inspect the application. Playwright provided reproducible screenshots, keyboard, responsive and axe checks. This is evidence for the tested local paths, not a blanket production-readiness or accessibility certification. Full local results are under the ignored `var/victim-design/`, `var/frontend-validation/quality/` and `var/ux-repair/` folders. No session cookies or reply capabilities are committed.

## Visual comparison ledger

The earlier rendered application was captured before changing the built assets. The generated concept guided hierarchy and geometry; implementation screenshots were inspected directly. The concept is a preview under `var/victim-design/concept.png`, created with the built-in image-generation tool. No raster UI or generated text image is used in the application.

| Surface | Concrete repairs compared with baseline | Evidence |
| --- | --- | --- |
| Shared shell | Stronger brand alignment; larger serif heading; legible slate text; quieter practice identity; contextual vertical journey; useful golden-hour panel; mobile disclosure instead of lost guidance | [Practice entry](media/victim-experience/practice-start.png) |
| Practice setup | Comparable timing choices; responsive vertical choices; clear setup hierarchy; compact setup-time note; customer cards without nested scroll trap; selected-account outline; preserved busy/build animation | [Practice entry](media/victim-experience/practice-start.png) |
| Account home | Reporting invitation is the primary task; optional practice explanation uses disclosure; clearer action grouping; calm teal surface; reports/payments separated; newest payments first | [Account home](media/victim-experience/account-home.png) |
| Payments | Step-specific heading; connected progress; active rail; outlined selection; scenario warning stripe; long handles wrap; selection count; obsolete validation clears | [Before](media/victim-experience/before-payments.png), [desktop](media/victim-experience/payments-desktop.png), [mobile](media/victim-experience/payments-mobile.png) |
| Narrative | Own-words heading; readable field; optional references stay collapsed; consistent label spacing; focused heading; clear optional contact-time explanation; chronology confirmation preserved | `var/victim-design/final/narrative-*.png` |
| Evidence | Actual upload before practice tools; refined native picker; grouped attachment rows; human-readable kinds; wrapping filenames; quieter sample panel; real generation requests retained | [Evidence](media/victim-experience/evidence-desktop.png) |
| Review | Distinct heading; narrative preserves line breaks; readable summary; clear step count; aligned actions; reachable mobile submission controls | `var/victim-design/final/review-*.png` |
| Confirmation | Prominent receipt; readable reference; actual processing state; exact-case analyst handoff; next-stage explanation; evidence and questions remain distinct | [Confirmation](media/victim-experience/confirmation.png) |
| Customer reply | Plain-language context; focused request; larger notes field; native evidence input; full-width action; long-content wrapping; expiry/error handling retained | [Reply on mobile](media/victim-experience/reply-mobile.png) |

Copy comparison: functional labels Back, Continue, Submit report, Submit reply, Report a payment scam and the analyst handoff remain intact. Deliberate changes include four descriptive report-stage titles, calmer support copy, human-readable evidence kinds and a next-stage explanation. The final reply eyebrow is “A message from your fraud desk”; reply screenshots captured before the final copy-only edit show the earlier eyebrow. Geometry and behaviour are unchanged.

The concept's single-payment radio control is deliberately corrected to the required multiple-payment checkboxes. Actual owned payments, amounts and references replace concept examples. The established ivory canvas and white panels are retained instead of the concept's all-white main region. The concept is a 1487x1058 composite; desktop renders are 1440x1000. This is a visual comparison, not a pixel-identical claim.

## Architecture and review notes

- Styling is isolated in `frontend/src/pages/victim/victim-premium.css`, imported after existing styles. Staff styles and backend source are unchanged.
- `Victim.jsx` retains API/state, cookie/session, idempotent submission, upload, candidate-decision, reply-capability and tour-anchor contracts.
- Stage changes focus the current heading. The skip link focuses main without changing the hash route. Reduced-motion users receive no reveal animation.
- Evidence display names change; wire values remain `receipt/messages/call_log/narrative`.
- Obsolete payment validation clears when a choice changes. Home uses the existing newest-first payment helper.
- No packages, provider settings, cloud resources or deployment flags changed. Nothing was pushed or deployed.

## Run and review

Preview: **http://127.0.0.1:8208/app/#/victim/start**. The isolated Docker project is `caseproof-victim-design`, with separate application, feed and receiver volumes. Other deployment, Studio and journey stacks were not rebuilt or restarted.

From this worktree's `frontend` directory:

```powershell
npm ci
npm run build
npm test
$env:CASEPROOF_BASE_URL='http://127.0.0.1:8208'
node scripts/victim-design-browser.mjs
node scripts/acceptance-browser.mjs
node scripts/guided-ux.mjs
```

The preview serves built assets; rebuild after source edits. The ignored local Compose file is `var/frontend-main-integration/compose.json`, already configured for this worktree, port 8208 and its separate project. Do not regenerate it with the helper's default project name while other validation stacks exist.

Manual review: start a fresh practice session, choose 10 minutes and a marked customer, continue to the account and report the marked payment. Describe the incident; upload supported originals or generate labelled samples; review and submit. The confirmation opens that exact case as Analyst demo. Send clarification only when proposed; its link opens the redesigned reply screen. Use Reviewer demo for eligible current-revision approval, then verify both receiver acknowledgements and follow-up. New complaints do not depend on hardcoded case IDs.

## Remaining boundaries

The existing deployed Document AI and Vertex AI Gemini configuration is preserved. Local tests deliberately use local OCR/rules and synthetic receiver services. They do not revalidate cloud sign-in or change the deployed provider. Real bank authentication, real bank connectivity, freezes, refunds and regulatory filing remain outside these tests. Automated accessibility and keyboard checks passed; screen-reader user testing and real-device usability research remain before a production accessibility claim. English copy and existing supported upload formats remain the scope.

## Follow-up: evidence progress, role handoff and tour reliability

The three evidence generators now retain separate labels. Only the clicked type displays “Creating receipt/chat/call log…” and `aria-busy=true`. The other actions are temporarily disabled to prevent overlapping requests, but do not imply that their files are being generated. Failure restores the controls and keeps the actual error visible.

The customer receipt no longer contains an analyst action. Once the backend confirms the case, the existing top-right demo control becomes **Continue as analyst**, opens that exact case and has a dismissible next-step explanation. This is restricted to explicit demo personas. The customer-facing report, processing state and evidence remain separate from the role switch. The confirmation returns to the top, and its header stays visible while scrolling.

The reported tour warning came from a combined evidence/submission highlight still looking for the evidence heading after the customer reached Review. It now follows the visible Evidence or Review stage. Both the real form's Back and the tour's Back preserve entered information and show the appropriate guidance. Back after submission explains that the report is already filed rather than seeking a vanished form. Automatic progression is latched to one transition per completed action, avoiding a double-advance race under delayed rendering.

Screenshot review also found that floating minimised guidance could cover the new handoff on mobile. **Resume tour** now occupies its own normal-flow position in the victim header. The real-browser check verifies the analyst button is the actual hit target at its centre, not covered by another control.

The updated guided run passed **54 checks**, including a real 31-second pause on Review, all three individual generation indicators, both Back controls, post-submission navigation, analyst/reviewer separation, both simulator acknowledgements and saved ownership. Its five accessibility scans had zero reported violations. The focused victim run passed **29 checks** and 27 scans, including header/resume overlap verification. The generation tests temporarily hold the actual backend image response for deterministic progress assertions; they do not fabricate its contents.

Updated screenshots: [handoff on desktop](media/victim-experience/confirmation.png), [handoff with Resume tour on mobile](media/victim-experience/handoff-resume-mobile.png). The machine-readable validation records the current test counts. These changes remain in the independent victim-experience worktree; no push, merge, provider change or deployment was performed.
