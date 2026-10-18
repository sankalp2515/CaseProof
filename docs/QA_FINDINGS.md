# QA findings — persona testing on Google staging (17–18 October 2026)

## Status after the 18 October fixes

Fixed and deployed: E1/B2 (clear `401 practice_session_required` plus a "Start a practice
session" button), E2/B1 (first visit gets an empty list and a prompt, never a 503), F1/F2/F5
(plain-language messages), B5 (503 retry signals log at WARNING; the alert counts only
structured errors and needs more than 3 in five minutes), B8/G5 (200 sessions and 3,000
Gemini calls per day, configurable in Terraform; per-case ceiling 24; hard ceilings raised),
the 49 s cold virus scan (scanner kept warm), and the evidence viewer retrying while a scan
is pending. Model moved to `gemini-3.5-flash` (same Mumbai region). New Gemini features: a
source-checked case summary and cybercrime statement (Overview, delivered report), "Ask
Gemini to read this image" (Evidence), and a multilingual "what is my description missing"
helper (victim report). Still open: B3, B4, B6, B7, B9 to B12, F3, F4, F6 to F8, D1 to D4.

The notes below are the original findings. Environment:
https://8-233-217-230.sslip.io, build `f3b6d3c`. Synthetic data only.

How it was tested
- `scripts/persona_qa.py`: 19 API-level personas acting as real (not always
  cooperative) users, plus 4 concurrent "judges" — 16/19 passed, 81 non-2xx
  responses, **zero 5xx**. Raw: `var/qa/personas.json`.
- Headless browser personas (first-time visitor, analyst-first visitor, phone user,
  stale deep link). Screenshots: `var/qa/ui/`.
- Full UI acceptance suite on staging earlier the same day: 32/32.
- Google Cloud Logging reviewed for every ERROR since deployment.

## The two reported errors (root causes confirmed)

| # | What the user saw | Root cause | Who hits it |
| --- | --- | --- | --- |
| E1 | Analyst view: "Session expired or this action is not permitted." | Analyst/Reviewer personas are only honoured with a practice-session cookie (`cp_demo`). Without it every staff API returns `403 access_denied`, and the UI maps every 403 to that generic message. | Anyone who opens **Fraud desk workspace** from the entry page before starting a practice session; anyone who starts the victim flow in one browser/device and opens the analyst view in another (or in an incognito window); anyone whose 24 h cookie expired. Also shown for a case that belongs to another session (U4). |
| E2 | Victim start: `synthetic_bank_data_not_preloaded` (raw code) | The start page requests the customer list before any session exists. Without a cookie the API falls back to a shared "demo" catalogue that was never created on staging (it needs an admin preload, impossible with practice personas). Returns `503` and the UI prints the raw code. | **Every first-time visitor** (P01, U1) and anyone whose session expired. |

## Persona results

| ID | Persona / edge case | Result | Notes |
| --- | --- | --- | --- |
| P01 | First visit, victim start page | **FAIL** | E2 |
| P02 | Opens fraud desk before a session | **FAIL** | E1 |
| P03 | Session generation (10 min) | Pass | 12 distinct names, 6 victims, catalogue in 1.8 s |
| P04 | Cooperative golden-hour victim | Pass | Document AI + Gemini live, 9 OCR lines, 8 facts, ledger match, trail, 49 min left; 33 s; `/me` waited 25 s for bank publication |
| P05 | Reports an ordinary grocery payment | Pass | Not treated as complete; golden-hour clock still runs for an ordinary payment (see D3) |
| P06 | Cannot identify the payment | Pass | Gaps listed, request generated |
| P07 | Uploads a PDF | Pass (UX gap) | Rejected `422 invalid_request_or_state`: generic message (F5) |
| P08 | Uploads a random photo | Pass | No OCR facts invented; `readable_receipt` gap raised |
| P09 | Prompt injection + `<script>` in narrative | Pass | Flagged `embedded_instruction`, not obeyed, no 99-crore amount verified, not auto-approved |
| P10 | Hinglish / Devanagari narrative | Pass | 9 facts extracted |
| P11 | Double-submit, then files same payment again | **FAIL** | Double-submit idempotent, but a second complaint for the same payment is **not flagged as overlapping** in the cloud (B3) |
| P12 | 6 MB file; EICAR test file | Pass | 413 for size; EICAR accepted with 200, quarantined, never extracted (B11) |
| P13 | Analyst approves; reviewer approves stale revision; reviewer sends request | Pass | 403 / 409 / 403 |
| P14 | Visitor B reads A's case; persona header `admin`; foreign receipt | Pass | All 403 |
| P15 | Customer link forwarded, tampered, reused | Pass (design note) | Tampered and reuse refused; a forwarded link works for whoever holds it (B10) |
| P16 | Scam 40 min ago | Pass | 16 min left at assessment |
| P17 | Disputes both scam debits | Pass | 2 ledger matches, 2 trail transfers |
| P18 | Four judges at the same time | Pass (slow tail) | 39 s, 39 s, 118 s, 182 s; tail caused by Document AI timeouts (G2) |
| P19 | Deep links, missing case, no-session submit, invalid scenario | Pass | Clean 4xx |
| U3 | Phone user (375 px) end to end | Pass (UI gaps) | Submitted in 20 s, no horizontal overflow; status badge "unknown" (F3); search overlaps header (F6) |

## Bugs and gaps

### Backend / API
- **B1 (critical, E2)** No catalogue without a session → `503` on every first visit. Fix idea: on first visit create (or prompt to create) a practice session; never fall back to the shared tenant on staging.
- **B2 (critical, E1)** Practice personas need the cookie, with no explanation. Fix idea: `401 practice_session_required` + UI prompt "Start a practice session to open the fraud desk", with a one-click start; mention that victim and analyst must use the same browser.
- **B3** Overlapping complaints (same payment filed twice) not detected in the cloud adapter (local works).
- **B4** Cloud victim complaint response lacks `processing` (`state`, `message`), so the victim sees an "unknown" badge and no progress text. Local/cloud contract drift.
- **B5** `503 bank_data_preparing` (an expected wait) is logged at ERROR severity, so the backend-errors alert fires and emails the owner. Log at INFO/WARNING.
- **B6** Bank publication takes 15–40 s per new session (about a dozen BigQuery publish tasks at ~2.5 s each). The victim waits on "Opening your account…".
- **B7** One Firestore `409` transaction conflict under concurrency (retried; monitor).
- **B8 (judging-day risk)** Global caps: **50 practice sessions/day** (31 used on 17 Oct by testing alone) and **300 Gemini calls/day**, shared by all visitors and reset at 00:00 UTC (05:30 IST). Exhaustion shows a raw `daily_practice_session_limit` or failed processing.
- **B9** `ledger_coverage` stays unresolved until the scheduled bank refresh (1–2 min), so a reviewer cannot decide immediately and nothing tells them why they are waiting.
- **B10** Customer reply links are bearer capabilities: anyone the link is forwarded to can answer (by design; a demo-acceptable risk).
- **B11** Malware upload returns `200`. The evidence is quarantined silently; the victim is not told the file was rejected (analyst visibility not verified).
- **B12** Golden-hour clock and "recoverable now" are computed for any disputed debit, including an ordinary grocery payment.

### Frontend / UX
- **F1** Raw error codes shown to users (`synthetic_bank_data_not_preloaded`, `invalid_request_or_state`, `request_body_limit`, `daily_practice_session_limit`).
- **F2** Every 403 reads "Session expired or this action is not permitted", including "case not in your session" (U4) and "no session yet" (E1).
- **F3** Victim complaint page shows an "unknown" status badge (B4).
- **F4** The entry page offers **Fraud desk workspace** as an equal first step, which fails without a session.
- **F5** PDF/size rejection messages are not actionable ("Only PNG, JPEG or text up to 5 MB").
- **F6** Phone: the queue search box overlaps the "Case queue" header; KPIs show ₹0 and "—" while the first case is processing, which looks broken.
- **F7** Long waits (bank publication, Document AI) show only a spinner and text; no progress indication.
- **F8** The delivered report sits below the fold under "Delivered packet history"; not discoverable without the tour.

### Data / realism
- **D1** All six victims in a session share the same template (same story, same receipt layout, same mule pattern); amounts and depth vary but receipts are clean, typed images, so OCR always succeeds.
- **D2** The money trail does not evolve after the session starts: downstream reports are generated once, and refreshes re-observe the same balances. No new withdrawals appear while judges watch.
- **D3** The ordinary grocery payment is fixed at 25 min ago regardless of the chosen scenario; reporting it still starts golden-hour urgency.
- **D4** No simulated bank replies after delivery (e.g. "₹38,000 held at Bank B").

### Google services observed
- **G1** BigQuery `400` concurrent-transaction aborts: 25+ before the MERGE fix; **none since**.
- **G2** Document AI read timeouts (45 s) twice during the concurrent test, causing a 2–3 min tail. No fast retry or timeout shorter than the job lease.
- **G3** Vertex Gemini `429 RESOURCE_EXHAUSTED` (5 earlier on 17 Oct) and 2 daily-cap hits; handled by retries now, but capacity is shared in Mumbai.
- **G4** Firestore `409` once (B7).
- **G5** The Gemini cap counts retries and corrective calls; heavy testing consumes the judges' budget.

## Generative AI usage (audited in code, as deployed)

| Component | Uses Gemini? | Notes |
| --- | --- | --- |
| Fact extraction from the victim's narrative + receipt text | **Yes**: `gemini-2.5-flash` on Vertex AI (Mumbai), schema-constrained JSON with citations to source lines, plus one corrective retry | The only Gemini call in the deployed flow (`caseproof/adapters/provider.py: extract_claims`) |
| Reading the receipt image | No: Document AI OCR (Gemini image transcription exists in code but is not used when Document AI is configured) | |
| Agentic investigation (Gemini function calling to look up transactions / linked complaints) | Implemented, **switched off** (`agentic_investigate=False`) | `caseproof/adapters/investigation_tools.py` |
| Investigation brief, requests, readiness, report, money trail | No: deterministic code and templates | By design: "rules decide" |
| Victim-facing language, translation, report drafting | No | |

## Round 2 review (18 October, after commit 896a8a9) — notes only

Measured on staging: practice bank ready in 53 s for a lone visitor after idle, and 10–27 s
for four parallel visitors. Each session publishes about 34 BigQuery batches at ~2.7 s each
through the shared five-lane queue; the API, worker and simulator start cold (min 0).

### Still possible errors / friction
- R1 Cold starts: API, worker, simulator and frontend scale to zero; the first visitor after idle waits longest (53 s measured).
- R2 Bank set-up time varies from 10 to 53 s and shares the queue with complaint processing; past 120 s the client gives up and shows an error.
- R3 Cloud Armor allows 30 victim POSTs per minute **per IP**: judges behind one venue NAT or office Wi-Fi can hit 429.
- R4 The Gemini summary card silently disappears on a Gemini 429 or cap hit; a single 429 makes that API instance skip Gemini for 60 s (circuit file); a 403/404 skips it for 24 h.
- R5 The summary is regenerated for every changed revision; summary, evidence reading and retries share one 24-call budget per case, so a long demo can exhaust it.
- R6 If every summary sentence fails verification, the card renders with an empty list.
- R7 Document AI read timeouts (45 s) under concurrency: a case can take 2–3 min.
- R8 The shared daily counters (`demo_limits/sessions-<day>`, `model_limits/day-<day>`) are single Firestore documents updated in transactions: contention under load (the Firestore 409 seen) and a scalability ceiling.
- R9 The victim and the analyst must use the same browser; phone plus laptop still yields "No practice session".
- R10 sslip.io may be blocked or flagged by corporate filters, and looks untrustworthy.
- R11 iPhone photos default to HEIC, which is rejected (PNG/JPEG only); PDFs are rejected too.
- R12 Only transaction index 2 has an image receipt (`victim.py` receipt endpoint); disputing the ₹11,000 second debit downloads a JSON text "receipt".

### Not yet tested end to end
The full 32-step acceptance suite and the tour after this deploy; analyst sends a request →
victim answers through the customer link in the UI; reviewer rejects or returns a case;
a second complaint, or a second customer, in the same session; the 120-minute (elapsed)
scenario in the UI; a refresh or back button mid-report; session expiry; Safari and
Firefox; keyboard-only and screen-reader use; slow 3G; the analyst view on a phone; a
long narrative or emoji; Hindi-script narrative through the UI.

### Synthetic-data effects
Visible synthetic identifiers (`SIM-…`, `SYNTH-TX-…`, `@fictional.invalid`, "CEDAR DEMO BANK -
SYNTHETIC") flow into the Gemini text; identical scam template for every victim; clean typed
receipts (OCR never struggles); static money trail; a fixed 25-minute grocery payment;
overlap detection missing in the cloud, so "linked complaints" is always empty; the golden-hour
clock is real time, so a slow judge on the 10-minute scenario sees "elapsed".

### Presentation weaknesses
Bank jargon on screen (disposition, REVIEW_REQUIRED, ledger_coverage, revision r4, digests);
switching personas through a "Demo identity" dropdown; no before/after view of the analyst's
saved effort; spinners during 10–53 s waits; agentic investigation still off; accessibility
not audited; README, deck and video not done.

## Round 3 (18 October, staging build after the delivery-window fix) — status

Verified on staging with live Document AI, Gemini 3.5 Flash and BigQuery: acceptance 36/36,
guided tour 38/38 (15 highlights), practice bank ready in 5–10 s (single BigQuery MERGE).

Fixed this round: lifetime 50-complaint cap that silently blocked every new complaint
(now 500/day + 25/session); split delivery when a bank update landed between the two sends
(export now opens a 3-minute delivery window for automatic bank updates); repeat-complaint
reprocessing loop; trail conflict on a second refresh; ledger-coverage wait; tour rewritten
around the golden-hour story, roles and the AI features; plain-language brief summary.

Open, in priority order:
1. Domain: sslip.io may be blocked or distrusted (decision: buy a domain or use Firebase Hosting).
2. Gemini capacity: a Mumbai 429 hides the AI summary/investigator silently (consider the
   global endpoint for these on-demand features, and a visible "try again").
3. Victim and analyst must share one browser; cross-device judges see "No practice session".
4. A scheduled cash-out (minute 20/30/45/55 after the scam) creates a new case version; if it
   lands just before approval, the reviewer must reload and approve again (by design).
5. Linked complaints show on the later complaint only (linking looks back 72 hours).
6. Per-case Gemini budget (24 calls) shared by summary and image reading; heavy use can hit it.
7. Synthetic realism: one scam template, clean typed receipts, OCR never struggles.
8. Accessibility: sampled axe scans are clean, but no full audit; no Hindi interface.
9. Analyst workspace is not designed for phones.
10. Local stack: cash-outs are cloud-only; three OCR tests need Linux (Tesseract).
11. Trade-offs: API may write synthetic bank data; customer reply links are bearer links;
    staging costs ~US$3–4/day with warm API, worker and scanner.
