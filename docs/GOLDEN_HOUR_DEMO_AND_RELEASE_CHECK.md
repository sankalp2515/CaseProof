# Golden-hour demonstration and release check

Date: 18 October 2026.

## Main integration

The analyst-density and live Money Trail redesign was merged into `main` as `a9ee774`. The merge preserves the victim redesign, the top-level golden-hour response window, source inspection, reviewer permissions and the existing backend workflow. Unrelated untracked work in main was left alone.

Two tour instructions were clarified after the first successful end-to-end run:

- Requests explains how to send a proposed question, use the scoped customer reply, decide any additional payment and wait for reassessment. It no longer describes every request as optional regardless of the case's gaps.
- Delivery explicitly names sending, both acknowledgements, switching back to analyst and saving follow-up ownership. Inspecting a report alone does not complete the journey.

Browser scripts now accept `CASEPROOF_QA_OUTPUT` so Docker and native runs retain separate evidence. This does not modify product responses or workflow rules.

## Demonstration to use

The problem to show is a time-sensitive, fragmented complaint: a customer's account of a bank-impersonation call, an uploaded receipt, bank ledger entries, onward transfers and an uncertain extra debit. The analyst needs a supported first action and a defensible handoff while the response window is running.

Use a **new session with “10 minutes ago”**, rather than an old completed case whose golden hour has naturally elapsed. The clock is based on server-owned bank payment time. A new complaint does not fabricate a bank trail from its narrative: the practice session generates the fictional bank network first, and the complaint selects the customer's actual synthetic ledger payments.

Suggested narrative (use the selected payment's actual amount):

> A caller claimed to be from my bank's fraud team and said my account was compromised. He asked me to transfer money to a safe account. I made the selected payment while he stayed on the call. He stopped answering afterwards. I now believe I was deceived. I did not share an OTP or PIN.

Do not state that every complaint has the same amount, graph, missing question or readiness. Those depend on current evidence and the generated bank records.

## Click-by-click path for a new complaint

1. Open the landing page and choose **Tour**, or use the Tour button on the victim start screen. Next opens practice setup. Minimise guidance when working in the form; Resume tour restores it.
2. Choose **10 minutes ago**, then **Start a fresh practice session**. Wait for bank preparation to finish. Choose a customer marked with a suspicious payment, then **Continue with selected customer**.
3. Choose **Report a payment scam**. Select the suspicious payment, leaving ordinary payments separate, and Continue. The list is newest first.
4. Enter the narrative above and select **I made the payment after being deceived**. Leave unknown first-contact time blank. If entering a contact time after the payment, correct it or explicitly confirm the warning; this never changes the bank clock.
5. Attach a real supported receipt/chat/call-log file. For the practice bank receipt, use **View bank receipt**, download it and upload it with **Report evidence**. Alternatively create clearly labelled synthetic samples. Only the clicked sample button should show generation progress. The tested receipts were processed by the actual OCR worker.
6. Continue, review and **Submit report**. Wait for all selected evidence uploads. A case reference is registration, not completed extraction. Retry failed uploads on the same complaint.
7. Use **Continue as analyst demo** in the header. An already-open analyst queue receives the golden-hour alert automatically. Show its selected-payment amount and bank-timed response window, then open the exact case. Do not create a second practice session in another browser.
8. On Overview, start with the response window, next action, brief and matched payment inventory. Distinguish customer-reported statements, extracted details and bank matches. Processing can continue after submission; wait for the actual workflow/job to settle.
9. On Evidence, select the receipt and follow a fact's citation back to the original/source box. This is the evidence for trusting the summary. An extracted number alone is not bank verification.
10. On Money Trail, expand the graph, follow the selected debit and select an account. Show the amount/time labels, source/observation inspector and replay. Availability is an assessment-time observation; replay does not reconstruct historical balances or prove a hold.
11. On Requests, send a proposed unresolved question using **Review & send → Confirm request**. Open **Open scoped reply**, answer as the customer and Submit reply. Return to the report and explicitly confirm or exclude any additional debit according to the scenario. Return to the analyst case and wait for the new assessment. If there is no proposed question, do not invent one just for the video.
12. On Review & decision, use the next-action banner. The analyst cannot approve. Once the full report is eligible, choose **Continue as reviewer demo**, review the current readiness and write an independent rationale. **Review complete handoff → Approve revision …** approves only the displayed current revision and digest. If the case changes, reload and review again.
13. On Delivery & follow-up, as reviewer choose **Review & send approved reports → Confirm send**. Wait for **both** destination acknowledgements. Queued export is not delivery. Open **View delivered report** and show **Where the money was traced** in the readable investigation document.
14. Switch back to **Analyst demo**. Save Owner, Next action and Assignment reason. Verify awaiting-external follow-up, reload and show that ownership and history persist. The tour's Finish becomes available only after the actual delivery and saved ownership checks pass.

An urgent referral is a separate early, reviewer-authorised transaction referral when supported by current bank facts even if full documentation has gaps. Do not substitute its approval for a complete report or claim it freezes funds. For the main video, complete the missing-information path and show the full reviewed handoff.

## Video emphasis

Keep the opening concise: “The customer has reported a safe-account scam; the analyst has minutes to reconcile evidence, identify the disputed payments and send a defensible report.”

Spend the demonstration on four visible decisions: why this case is urgent; which facts are supported; where the disputed money was observed; and why this exact report can now be authorised. Finish on the readable report, two acknowledgements and named next action. This demonstrates investigation support and a controlled handoff, rather than just a sequence of forms.

Avoid an unmeasured time-saving number, guaranteed recovery, real bank/regulator delivery or a closed-investigation claim. AI assists the investigation; deterministic backend rules, current source data and an authorised human govern financial decisions and approval.

## Verification evidence

The merged main frontend was served through Vite at `http://127.0.0.1:8236/app/`, with the real isolated native backend/worker on 8230, feed on 8232, receivers on 8233 and actual Tesseract OCR on 8234. The backend checkout contains the same merged backend implementation. No API responses, approval readiness or acknowledgements were fabricated.

- Production build passed; 87 unit/component tests passed.
- The full guided tour passed twice, including the final instruction changes: **54 checks**, all 12 steps, 5 accessibility scans with zero violations and no uncaught browser errors. Final native guided case: `CASE-fdebb8ba1171a9f2`.
- The separate native workflow run passed **85 checks** across two fresh complaints: `CASE-12d52542ef4b2be2` and `CASE-f02c62fbc8953677`. It used an actual PNG receipt/OCR for one complaint and supported UTF-8 evidence for the other. Customer clarification, new revisions, denied/confirmed additional debits, role restrictions, readable delivered documents, both acknowledgements, ownership persistence and responsive layouts were exercised. Its 40 axe scans reported zero violations and no uncaught browser errors.
- The isolated Docker stack on port 8210 also passed **85 checks** across two fresh complaints, including the previously failing customer-reply completion. Its 40 axe scans reported zero violations and no uncaught browser errors. It served the merged main production build through Nginx and used the actual worker, image OCR, bank feed and receiver simulators. Earlier service-busy failures remain part of the history; a successful rerun does not establish their root cause. The additional Docker QA stack was stopped after verification, preserving its volumes.

Playwright exercised the rendered application, keyboard controls and real backend requests. Opening the new main preview through the in-app browser timed out while attaching its webview, so Playwright provided the repeatable UI verification. Screenshots were also inspected directly.

These are local provider-mode tests. They do not revalidate the deployed Google authentication, Document AI or Gemini service. The existing cloud provider configuration was not changed. The tour's cloud AI capabilities need a deployed-stage check before recording live AI claims.

[Test summary](media/golden-hour-demo/summary.json) · [Tour test results](media/golden-hour-demo/tour-results.json) · [Native workflow results](media/golden-hour-demo/native-workflow-results.json) · [Docker workflow results](media/golden-hour-demo/docker-workflow-results.json) · [Golden-hour alert](media/golden-hour-demo/golden-hour-alert.png) · [Tour completion](media/golden-hour-demo/tour-complete.png) · [Readable delivered report](media/golden-hour-demo/delivered-report.png).

## Deployment-stage checks

Deployment remains a separate stage. Use the merged production build and the intended cloud backend; keep secrets and identity tokens out of reports and URLs. Re-run one fresh 10-minute complaint on the deployed origin with its configured provider modes. Verify practice preparation, receipt OCR/source citations, any enabled Gemini assistance, customer reply links and cookies, role restrictions, exact-revision approval, both configured synthetic receiver acknowledgements, report content and persisted follow-up. Do not record a local-provider run as proof of live Gemini or Google authentication.

Stop recording and resolve any stuck job, failed upload, stale approval, missing acknowledgement or unrecoverable customer reply. Preserve the failed case and diagnostics instead of manufacturing a successful state. No cloud deployment or readiness/dispatch flag was changed by this local verification work.
