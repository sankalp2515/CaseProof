# Receipt association recovery and full workflow test

18 October 2026. Local preview: http://127.0.0.1:8208/app/ . Deployment remains on hold.

## Problem and fix

A cropped receipt with a misread payee correctly failed independent bank association. Selecting the bank payment did not make that uploaded receipt trustworthy. An existing `identify_receipt_payment` request asked for clarification, but its uploads were not bound as replacements and fulfillment could not resolve the association marker. This left the analyst without a functioning recovery path.

Policy `demo-policy-v6-receipt-recovery` now connects the existing identification request to a clearer-receipt recovery path. Both local and cloud capability adapters bind the reply to the problematic original. The existing upload and completion routes are reused; no token, role or CORS changes were needed.

The gap clears only when:

- The server-issued request is fulfilled and bound to exactly one original receipt.
- Exactly one different follow-up receipt is bound to that request.
- The replacement has no unresolved/conflicting extracted claims.
- Its amount, payment time and payee claims participate together in the same scoped bank match.
- An original transaction reference, if present, agrees with the replacement reference.

A selected payment alone, an unrelated upload, an unfinished reply or a bank match assembled without the replacement's identifying claims cannot clear the gap. Multiple originals/replacements remain conservative rather than being silently paired. Unavailable evidence can follow the existing explicit escalation path; it is not treated as a completed receipt match.

Original bytes, original claims and historical snapshot digests remain intact. The original mismatch marker remains visible in evidence history; readiness checks whether its bound replacement resolved the gap. New unassociated receipts still create their own gap. No fuzzy payee matching or bank-derived character replacement was introduced. This fixes recovery from OCR uncertainty, not OCR's ability to read every image perfectly.

## Reproduce in the UI

1. Submit a new practice complaint with a selected bank debit and a receipt whose payee cannot be matched.
2. In Analyst, inspect Evidence and the separate bank match. Complete handoff must remain unavailable.
3. In Requests, review the proposed clearer-receipt question and send it.
4. Open its **scoped reply link**. Upload a clearer supported receipt with amount, payment time and payee; submit the reply.
5. Return to the case and wait for the worker's new assessment. The replacement must independently match the bank before the gap clears.
6. Resolve any additional-payment question and other remaining facts. Only then use the explicit reviewer handoff.
7. Reviewer inspects the current version/report, records a reason and approves the current revision/digest.
8. Send the packet; verify both receiver acknowledgements, inspect the delivered document, set owner/next action and reload to confirm persisted follow-up.

## Actual verification

- Offline Linux regression in the test container: **375 passed, 0 failed** across unit, flow, safety and contract tests. Three warnings were reported: the existing TestClient deprecation, an in-memory Hypothesis database because the source mount is read-only, and the deliberately oversized-image safety fixture.
- Targeted backend regression: **26 passed**. The new flow test covers successful recovery, immutable originals/history, incomplete reply, unbound or ambiguous targets, missing bank corroboration, same-original reuse, wrong artifact stage and conflicting reference.
- Playwright recovery/full-workflow run: **81 checks passed**; two new complaints completed full reviewer handoff and both simulator acknowledgements, including generated document inspection and follow-up persistence.
- Complaint 1 used a deliberately changed single payee character in an actual uploaded UTF-8 receipt to reproduce the failed association deterministically. It then recovered through the real request/reply/upload/worker path. This is a controlled evidence-input fault, not a fabricated API response or OCR result.
- Complaint 2 uploaded a real downloaded PNG receipt through the actual local OCR pipeline and completed the same end-to-end workflow.
- **36 axe scans: zero reported violations.** Responsive case-screen checks at 390, 768, 1280 and 1440px passed with no body overflow. No uncaught browser errors. API/worker logs inspected after the run contained no matching traceback/error entries.
- Changed Python files pass Ruff checks. No production frontend styling was changed in this fix.

The initial broad Windows-host attempt recorded 366 passed, four failures and five skipped. Its failures were a Windows concurrent file-replacement permission error and three local OCR engine failures. The same selected test suite passed all 375 tests in the offline Linux container. These Windows-host limitations were not hidden or represented as successful tests.

One browser attempt opened the app during the deliberate API restart and encountered the existing service-unavailable screen with its retry button. The runner now checks actual `/health` and `/v1/ui-config` responses before opening the app; the final run passed on the finished code. No API responses are mocked or replaced.

Screenshots: [receipt request](media/receipt-recovery/receipt-request.png), [customer replacement](media/receipt-recovery/customer-replacement.png), [reviewer handoff](media/receipt-recovery/recovered-reviewer-handoff.png), [both deliveries](media/receipt-recovery/recovered-delivery.png), [delivered report](media/receipt-recovery/delivered-report.png). [Full Playwright results](media/receipt-recovery/playwright-results.json).

Run from `frontend/` in PowerShell:

```powershell
$env:CASEPROOF_BASE_URL='http://127.0.0.1:8208'
$env:CASEPROOF_RECEIPT_RECOVERY='1'
node scripts/analyst-workspace-browser.mjs
```

This creates new complaints and sends to the configured local simulators. Confirm the target first. Results and screenshots are written under `var/receipt-recovery/browser`; selected evidence is retained in `docs/media/receipt-recovery/`.

These are local tests using the real isolated worker, Tesseract, literal extraction and bank/feed/receiver simulators. Cloud adapter code shares the new binding logic, but live Document AI/Gemini and deployed cloud acceptance were not rerun or redeployed by this task. Automated accessibility checks are not a complete assistive-technology audit.
