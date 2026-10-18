import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const textEvidence = process.env.CASEPROOF_TEXT_EVIDENCE === "1";
const reuseBank = process.env.CASEPROOF_REUSE_BANK === "1";
const visualQA = process.env.CASEPROOF_VISUAL_QA === "1";
const recoverReceipt = process.env.CASEPROOF_RECEIPT_RECOVERY === "1";
const require = createRequire(import.meta.url),
  out = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    process.env.CASEPROOF_QA_OUTPUT || (visualQA
      ? "../../var/analyst-density/browser"
      : recoverReceipt
        ? "../../var/receipt-recovery/browser"
        : "../../var/analyst-workspace/after"),
  );
await fs.mkdir(out, { recursive: true });
const base = process.env.CASEPROOF_BASE_URL || "http://127.0.0.1:8080",
  browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  }),
  victim = await context.newPage(),
  staff = await context.newPage();
const checks = [],
  cases = [],
  audits = [],
  pageErrors = [],
  providers = [],
  decisionStages = [];
for (const p of [victim, staff]) {
  p.on("pageerror", (e) => pageErrors.push(e.message));
  p.setDefaultTimeout(120000);
} // cloud: async bank publication and live model calls
const check = (name, value = true) => {
  assert.ok(value, name);
  checks.push(name);
  console.log("PASS", name);
};
async function shot(p, name) {
  await p.screenshot({ path: path.join(out, name + ".png"), fullPage: true });
}
async function read(route) {
  const target = new URL(base);
  const headers = { "X-Demo-User": "analyst" };
  if (target.hostname.endsWith(".localhost")) {
    headers.Host = target.host;
    headers.Cookie = (await context.cookies(base))
      .map((c) => c.name + "=" + c.value)
      .join("; ");
    target.hostname = "127.0.0.1";
  }
  const r = await context.request.get(target.origin + route, { headers });
  assert.equal(r.status(), 200, route);
  return r.json();
}
async function settled(cid) {
  for (let i = 0; i < 90; i++) {
    const w = await read(`/v1/cases/${cid}/workflow`);
    if (
      !w.bank_data_refresh_required &&
      !["queued", "running"].includes(w.job?.status) &&
      w.status !== "processing"
    ) {
      assert.notEqual(w.job?.status, "failed");
      return w;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw Error("Assessment did not settle");
}
async function axe(p, name) {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const result = await p.evaluate(async () => {
    const r = await axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
      },
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    }));
  });
  audits.push({ screen: name, violations: result });
  await fs.writeFile(
    path.join(out, "axe-results.json"),
    JSON.stringify(audits, null, 2),
  );
  console.log("AXE", name, result.length);
}
async function navigate(p, route) {
  await p.goto(base + "/app/#" + route);
  await p
    .locator(".loading-state")
    .waitFor({ state: "hidden", timeout: 90000 })
    .catch(() => {});
}
let fullHandoffs = 0;
try {
  // Do not mistake a deliberately restarting local API for a rendered-flow failure.
  // Poll real readiness before opening the application; no response is substituted.
  let available = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await read("/health");
      await read("/v1/ui-config");
      available = true;
      break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(
    available,
    "Real API health and UI configuration must be available",
  );
  await victim.goto(base + "/app/#/victim/start");
  await victim
    .getByRole("button", { name: "Start a fresh practice session" })
    .waitFor({ timeout: 90000 });
  if (!reuseBank) {
    const fresh = victim.waitForResponse(
      (r) =>
        r.url().endsWith("/v1/victim/demo-session") &&
        r.request().method() === "POST",
      { timeout: 180000 },
    );
    await victim
      .getByRole("button", { name: "Start a fresh practice session" })
      .click();
    assert.equal((await fresh).status(), 200);
    await victim
      .getByRole("button", { name: "Start a fresh practice session" })
      .isEnabled();
  }
  await victim.waitForFunction(
    () => !document.querySelector(".customer-option")?.disabled,
  );
  await victim.locator(".customer-option").first().click();
  await victim
    .getByRole("button", { name: "Continue with selected customer" })
    .click();
  await victim.waitForURL(/victim\/home/);
  await staff.goto(base + "/app/#/staff/queue");
  if (!reuseBank) {
    await staff
      .getByText("No complaints in this practice session", { exact: true })
      .waitFor({ timeout: 90000 });
    check("Fresh practice has no fabricated complaints");
  } else check("Existing bank catalogue selected for new complaints");
  for (let run = 0; run < 2; run++) {
    if (run) {
      await navigate(victim, "/victim/start");
      await victim
        .locator(".customer-option:has(.incident-hint)")
        .nth(1)
        .click();
      await victim
        .getByRole("button", { name: "Continue with selected customer" })
        .click();
      await victim.waitForURL(/victim\/home/);
    }
    await victim
      .getByRole("button", { name: "Report a payment scam", exact: true })
      .click();
    await victim
      .getByRole("checkbox", { name: /Dispute payment .*-T1$/ })
      .check();
    await victim.getByRole("button", { name: "Continue", exact: true }).click();
    await victim
      .getByRole("textbox", { name: "What happened?", exact: true })
      .fill(
        run
          ? "I am reporting a suspicious transfer and need the fraud desk to check what happened."
          : "This is a new synthetic complaint about a payment. I need help understanding the suspicious incident.",
      );
    await victim.getByRole("button", { name: "Continue", exact: true }).click();
    let savedReceipt;
    if (!textEvidence && (recoverReceipt ? run === 1 : run === 0)) {
      const pending = victim.waitForEvent("download");
      await victim.getByRole("link", { name: /View bank receipt/ }).click();
      const downloaded = await pending;
      savedReceipt = path.join(out, `receipt-${run}.png`);
      await fs.copyFile(await downloaded.path(), savedReceipt);
    } else {
      // Supported UTF-8 test evidence from the live owned practice-bank record.
      // This does not fabricate API responses, readiness or financial matches.
      const me = await read("/v1/victim/me");
      const tx = me.transactions.find((t) => t.txn_id.endsWith("-T1"));
      const local = new Date(Date.parse(tx.ts) + 19800000).toISOString();
      savedReceipt = path.join(out, `receipt-${run}.txt`);
      await fs.writeFile(
        savedReceipt,
        `SYNTHETIC PRACTICE RECEIPT\nINR ${(tx.amount_minor / 100).toFixed(2)}\nDate: ${local.slice(0, 10)}\nTime: ${local.slice(11, 16)} IST\nTo: ${recoverReceipt ? (tx.payee[0] === "n" ? "m" : "n") + tx.payee.slice(1) : tx.payee}\n${recoverReceipt ? "Reference crop not included" : "UTR: " + tx.reference}\n`,
        "utf8",
      );
    }
    await victim
      .getByLabel("Report evidence", { exact: true })
      .setInputFiles(savedReceipt);
    await victim.getByRole("button", { name: "Continue", exact: true }).click();
    await victim
      .getByRole("button", { name: "Submit report", exact: true })
      .click();
    await victim.waitForURL(/victim\/complaints\/CASE-/, { timeout: 90000 });
    const cid = victim.url().split("/").at(-1);
    cases.push(cid);
    check("New complaint " + (run + 1) + " submitted with a supported receipt");
    await victim
      .getByText("2 evidence item(s) · includes your narrative", {
        exact: true,
      })
      .waitFor({ timeout: 90000 });
    let w = await settled(cid);
    const sourceSnapshot = await read(`/v1/cases/${cid}`);
    providers.push(sourceSnapshot.run_meta || []);
    check(
      "Real worker assessed complaint " + (run + 1),
      !textEvidence && (recoverReceipt ? run === 1 : run === 0)
        ? sourceSnapshot.segments.some((s) => s.box_2d)
        : sourceSnapshot.segments.length > 0,
    );
    if (recoverReceipt && run === 0) {
      check(
        "Unmatched receipt stays blocked before clarification",
        w.unresolved.includes("receipt_association") &&
          w.readiness === "REVIEW_REQUIRED",
      );
      check(
        "Backend proposes receipt recovery before other clarification",
        sourceSnapshot.requests.find((r) => r.state === "proposed")
          ?.catalogue_id === "identify_receipt_payment",
      );
    }
    decisionStages.push({
      caseId: cid,
      stage: "before clarification",
      revision: w.revision,
      readiness: w.readiness,
      urgentReferral: w.urgent_referral,
      unknowns: w.unresolved,
      nextAction: w.brief?.recommended_action,
    });
    check(
      "Urgent eligibility is separate from incomplete full handoff",
      w.urgent_referral.eligible && w.readiness !== "COMPLETE_CANDIDATE",
    );
    await staff
      .getByRole("button", { name: cid, exact: true })
      .waitFor({ timeout: 30000 });
    check("New complaint arrives automatically in analyst queue");
    await staff
      .getByRole("button", { name: /Notifications, [1-9]/ })
      .waitFor({ timeout: 30000 });
    check("Arrival notification visible to analyst");
    await staff.getByRole("button", { name: cid, exact: true }).click();
    await staff
      .getByRole("heading", { name: "Payment inventory", exact: true })
      .waitFor({ timeout: 30000 });
    if (visualQA)
      check(
        "Next-action banner stays compact at desktop",
        await staff
          .locator(".case-next-step")
          .evaluate((el) => el.getBoundingClientRect().height < 155),
      );
    await shot(staff, `after-overview-${run}`);
    await axe(staff, "overview");
    check(
      "Case next action precedes investigation content",
      await staff
        .locator(".case-next-step")
        .evaluate(
          (el) =>
            !!(
              el.compareDocumentPosition(
                document.querySelector(".analyst-overview-top"),
              ) & Node.DOCUMENT_POSITION_FOLLOWING
            ),
        ),
    );
    check(
      "Brief precedes optional AI tools",
      await staff
        .locator(".analyst-overview-top")
        .evaluate(
          (el) =>
            !!(
              el.compareDocumentPosition(
                document.querySelector(".analyst-assistance"),
              ) & Node.DOCUMENT_POSITION_FOLLOWING
            ),
        ),
    );
    await staff
      .locator(".tabs")
      .getByRole("button", { name: /^Evidence/ })
      .click();
    await staff
      .getByRole("heading", {
        name: "Details extracted from evidence",
        exact: true,
      })
      .waitFor();
    await staff.locator(".fact .chip-cite").first().click();
    await staff.locator(".source-selection").waitFor();
    check(
      "Readable fact citation selects the original source",
      !!(await staff.locator(".source-selection").textContent()),
    );
    await shot(staff, `evidence-${run}`);
    await axe(staff, "evidence");
    const amountFact = staff
      .locator(".fact")
      .filter({ has: staff.getByText("Amount", { exact: true }) });
    await amountFact
      .getByRole("button", { name: "Correct", exact: true })
      .click();
    await staff.getByLabel("Corrected value", { exact: true }).fill("1.5");
    await staff
      .getByLabel("Reason", { exact: true })
      .fill("Testing invalid fractional paisa input");
    check(
      "Fractional paisa correction is blocked",
      await staff
        .getByRole("button", { name: "Save correction", exact: true })
        .isDisabled(),
    );
    await staff.getByRole("button", { name: "Cancel", exact: true }).click();
    await staff
      .getByRole("combobox", { name: "Staff persona", exact: true })
      .selectOption("reviewer");
    await staff
      .getByRole("heading", {
        name: "Details extracted from evidence",
        exact: true,
      })
      .waitFor();
    check(
      "Reviewer can inspect evidence but cannot correct it",
      await staff
        .getByRole("button", { name: "Correct", exact: true })
        .first()
        .isDisabled(),
    );
    await staff
      .getByRole("combobox", { name: "Staff persona", exact: true })
      .selectOption("analyst");
    await staff
      .getByRole("heading", {
        name: "Details extracted from evidence",
        exact: true,
      })
      .waitFor();
    await staff
      .locator(".tabs")
      .getByRole("button", { name: "Overview", exact: true })
      .click();
    await staff
      .getByRole("heading", { name: "Payment inventory", exact: true })
      .waitFor();
    for (const identity of ["reviewer", "analyst"]) {
      await staff
        .getByRole("combobox", { name: "Staff persona", exact: true })
        .selectOption(identity);
      await staff
        .getByRole("heading", { name: "Payment inventory", exact: true })
        .waitFor();
    }
    check(
      "Identity switches do not create duplicate unread arrivals",
      (await staff
        .getByRole("button", { name: /Notifications, / })
        .getAttribute("aria-label")) === "Notifications, 0 unread",
    );
    await staff
      .getByRole("button", { name: "Money Trail", exact: true })
      .click();
    await staff.locator(".trail-node").first().waitFor();
    check("Backend trail rendered as account graph");
    await staff.locator(".trail-node").last().click();
    await shot(staff, `after-trail-${run}`);
    await axe(staff, "trail");
    await staff.getByRole("button", { name: "Requests", exact: true }).click();
    await shot(staff, `missing-information-${run}`);
    check(
      "Request recommendation is separated from history",
      (await staff.locator(".request-recommendation").count()) === 1,
    );
    check(
      "No ambiguous generic customer shortcut",
      (await staff
        .getByRole("button", { name: "Open victim portal", exact: true })
        .count()) === 0,
    );
    await axe(staff, "requests");
    await staff
      .getByRole("combobox", { name: "Staff persona", exact: true })
      .selectOption("reviewer");
    await staff
      .getByRole("heading", { name: "Customer clarification", exact: true })
      .waitFor();
    check(
      "Reviewer cannot send analyst clarification",
      await staff
        .getByRole("button", { name: "Review & send", exact: true })
        .isDisabled(),
    );
    await staff
      .getByRole("combobox", { name: "Staff persona", exact: true })
      .selectOption("analyst");
    await staff
      .getByRole("heading", { name: "Customer clarification", exact: true })
      .waitFor();
    await staff
      .getByRole("button", { name: "Review & send", exact: true })
      .click();
    await staff
      .getByRole("button", { name: "Confirm request", exact: true })
      .click();
    const reply = staff.getByRole("link", {
      name: "Open scoped reply",
      exact: true,
    });
    await reply.waitFor({ timeout: 30000 });
    const replyHash = await reply.getAttribute("href");
    await victim.goto(base + "/app/" + replyHash);
    await victim
      .getByRole("textbox", { name: "Notes / explanation", exact: true })
      .fill(
        run
          ? "A fake support caller instructed me to pay. I followed the caller and later realised the scam."
          : "A caller impersonated bank support and told me to transfer money for account verification. I was deceived and followed the instruction.",
      );
    if (recoverReceipt && run === 0) {
      const me = await read("/v1/victim/me");
      const tx = me.transactions.find((t) => t.txn_id.endsWith("-T1"));
      const local = new Date(Date.parse(tx.ts) + 19800000).toISOString();
      const replacement = path.join(out, "clearer-receipt.txt");
      await fs.writeFile(
        replacement,
        `SYNTHETIC REPLACEMENT RECEIPT\nINR ${(tx.amount_minor / 100).toFixed(2)}\nDate: ${local.slice(0, 10)}\nTime: ${local.slice(11, 16)} IST\nTo: ${tx.payee}\nUTR: ${tx.reference}\n`,
      );
      await victim
        .getByLabel("Reply evidence", { exact: true })
        .setInputFiles(replacement);
      await shot(victim, "scoped-receipt-reply");
    }
    await victim
      .getByRole("button", { name: "Submit reply", exact: true })
      .click();
    await victim
      .getByRole("heading", {
        name: "Thank you. Your reply is received.",
        exact: true,
      })
      .waitFor({ timeout: 90000 });
    check("Actual missing-information link reply received");
    const before = w.revision;
    w = await settled(cid);
    check("Reply creates a new assessment revision", w.revision > before);
    if (recoverReceipt && run === 0) {
      check(
        "Bank-matched bound replacement resolves receipt association",
        !w.unresolved.includes("receipt_association"),
      );
      const afterReplacement = await read(`/v1/cases/${cid}`);
      check(
        "Original evidence hash is retained after recovery",
        sourceSnapshot.artifacts.every((a) =>
          afterReplacement.artifacts.some(
            (b) => a.artifact_id === b.artifact_id && a.sha256 === b.sha256,
          ),
        ),
      );
      check(
        "Original mismatch remains visible in evidence history",
        afterReplacement.claims.some((c) =>
          c.confidence_note.startsWith("receipt_unassociated:"),
        ),
      );
    }
    await victim
      .getByRole("button", { name: "Return to your report", exact: true })
      .click();
    await victim
      .getByRole("heading", { name: "Received evidence", exact: true })
      .waitFor({ timeout: 90000 });
    const deny = victim.getByRole("button", {
      name: "No, this payment is unrelated",
      exact: true,
    });
    if (await deny.count()) {
      if (visualQA && run === 1)
        await victim
          .getByRole("button", {
            name: "Yes, dispute this payment",
            exact: true,
          })
          .click();
      else await deny.click();
      await victim
        .getByRole("button", {
          name:
            visualQA && run === 1
              ? "Confirm dispute"
              : "Confirm unrelated payment",
          exact: true,
        })
        .click();
      await victim
        .getByText("No clarification is needed from you right now.", {
          exact: true,
        })
        .waitFor({ timeout: 90000 });
      check(
        visualQA && run === 1
          ? "Additional debit explicitly confirmed"
          : "Additional debit explicitly denied",
      );
    }
    w = await settled(cid);
    await navigate(staff, `/staff/cases/${cid}/review`);
    await staff
      .getByRole("textbox", { name: "Reviewer rationale", exact: true })
      .fill(
        "Synthetic acceptance: reviewed the current bank-matched payment, original receipt, clarification and excluded candidate. Decision applies only to current supported content.",
      );
    check(
      "Analyst reviewer-only control disabled",
      await staff
        .getByRole("button", { name: "Review complete handoff", exact: true })
        .isDisabled(),
    );
    if (recoverReceipt && run === 0)
      check(
        "Recovered case reaches full readiness without a bypass",
        w.readiness === "COMPLETE_CANDIDATE",
      );
    if (!["COMPLETE_CANDIDATE", "ESCALATE_CANDIDATE"].includes(w.readiness)) {
      check(
        "Incomplete receipt cannot be promoted to complete handoff",
        (await staff
          .getByRole("button", {
            name: "Continue as reviewer demo",
            exact: true,
          })
          .count()) === 0,
      );
      decisionStages.push({
        caseId: cid,
        stage: "blocked full review",
        revision: w.revision,
        readiness: w.readiness,
        unresolved: w.unresolved,
      });
      await shot(staff, "blocked-complete-handoff");
      if (w.urgent_referral?.eligible) {
        await staff
          .getByRole("button", {
            name: "Continue as reviewer for urgent referral",
            exact: true,
          })
          .click();
        await staff
          .getByRole("textbox", { name: "Reviewer rationale", exact: true })
          .fill(
            "Approve only an urgent referral for the bank-confirmed debit. Receipt association remains unresolved; no complete packet or recovery is claimed.",
          );
        await staff
          .getByRole("button", { name: "Review urgent referral", exact: true })
          .click();
        await staff.getByRole("button", { name: /Approve revision / }).click();
        await staff
          .getByRole("button", {
            name: "Send approved referral to simulator",
            exact: true,
          })
          .click();
        let history = [];
        for (let i = 0; i < 20; i++) {
          history = await read(`/v1/cases/${cid}/urgent-referrals`);
          if (history.some((x) => x.delivery)) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
        check(
          "Separate urgent referral records its actual acknowledgement",
          history.some((x) => x.delivery),
        );
      }
      await staff
        .getByRole("combobox", { name: "Staff persona", exact: true })
        .selectOption("analyst");
      continue;
    }
    await staff
      .getByRole("button", { name: "Continue as reviewer demo", exact: true })
      .click();
    check(
      "Explicit handoff switches to reviewer for this case",
      (await staff
        .getByRole("combobox", { name: "Staff persona", exact: true })
        .inputValue()) === "reviewer",
    );
    await shot(staff, `reviewer-handoff-${run}`);
    await axe(staff, "reviewer");
    await staff
      .getByRole("textbox", { name: "Reviewer rationale", exact: true })
      .fill(
        "Synthetic acceptance: checked source citations, own-bank match, customer clarification and current observation limits. Approve only the displayed supported revision.",
      );
    for (let attempt = 0; attempt < 5; attempt++) {
      await settled(cid);
      await staff
        .getByRole("button", { name: "Review complete handoff", exact: true })
        .waitFor({ timeout: 90000 });
      await staff
        .getByRole("button", { name: "Review complete handoff", exact: true })
        .click();
      await staff.getByRole("button", { name: /Approve revision / }).click();
      await staff.waitForTimeout(600);
      const wf = await read(`/v1/cases/${cid}/workflow`);
      if (wf.approval) break;
      const close = staff.getByRole("button", { name: "Close", exact: true });
      if (await close.count()) await close.click();
      if (attempt === 4) throw Error("Approval conflicted repeatedly");
    }
    await staff
      .getByRole("button", { name: "Delivery & follow-up", exact: true })
      .click();
    await staff
      .getByRole("button", {
        name: "Review & send approved reports",
        exact: true,
      })
      .click();
    await staff
      .getByRole("button", { name: "Confirm send", exact: true })
      .click();
    for (let i = 0; i < 240; i++) {
      w = await read(`/v1/cases/${cid}/workflow`);
      if (new Set(w.historical_deliveries.map((d) => d.kind)).size === 2) break;
      await staff.waitForTimeout(1000);
    }
    fullHandoffs++;
    check(
      "Both simulator acknowledgements recorded",
      new Set(w.historical_deliveries.map((d) => d.kind)).size === 2,
    );
    decisionStages.push({
      caseId: cid,
      stage: "after clarification and review",
      revision: w.revision,
      readiness: w.readiness,
      deliveredKinds: w.historical_deliveries.map((d) => d.kind),
    });
    await shot(staff, `after-delivery-${run}`);
    await staff.reload();
    await staff
      .getByRole("button", { name: "View delivered report" })
      .first()
      .click();
    await staff
      .getByRole("heading", { name: "Payment scam investigation report" })
      .waitFor();
    await staff.getByText("Where the money was traced").waitFor();
    await shot(staff, `delivered-report-${run}`);
    check("Delivered report readable as a document");
    await staff
      .getByRole("combobox", { name: "Staff persona", exact: true })
      .selectOption("analyst");
    await staff
      .getByRole("textbox", { name: "Owner", exact: true })
      .fill("Cedar fraud follow-up");
    await staff
      .getByRole("textbox", { name: "Next action", exact: true })
      .fill("Track receiving institution responses to the delivered packet.");
    await staff
      .getByRole("textbox", { name: "Assignment reason", exact: true })
      .fill("Delivery acknowledged; investigation remains open.");
    for (let i = 0; i < 5; i++) {
      await settled(cid);
      await staff
        .getByRole("button", { name: "Save follow-up", exact: true })
        .click();
      await staff.waitForTimeout(700);
      w = await read(`/v1/cases/${cid}/workflow`);
      if (w.followup.version > 0) break;
    }
    check(
      "Owner and awaiting_external follow-up saved",
      w.followup.version > 0 && w.followup.state === "awaiting_external",
    );
    await staff.reload();
    await staff
      .getByText("Current owner: Cedar fraud follow-up", { exact: false })
      .waitFor({ timeout: 30000 });
    check("Follow-up survives reload");
    await axe(staff, "delivery");
    await navigate(staff, "/staff/queue");
  }
  for (const width of [390, 768]) {
    await victim.setViewportSize({ width, height: 844 });
    await navigate(victim, "/victim/start");
    await victim.locator(".customer-option").first().waitFor();
    await shot(victim, `after-victim-${width}`);
    await axe(victim, "victim-" + width);
    check(
      "Victim no body overflow at " + width,
      await victim.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  for (const width of [1280, 1440]) {
    await staff.setViewportSize({ width, height: 900 });
    await navigate(staff, "/staff/queue");
    await shot(staff, `after-queue-${width}`);
    await axe(staff, "queue-" + width);
    check(
      "Analyst no body overflow at " + width,
      await staff.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  for (const width of [390, 768, 1280, 1440]) {
    await staff.setViewportSize({ width, height: 900 });
    for (const tab of [
      "overview",
      "evidence",
      ...(visualQA ? ["trail"] : []),
      "requests",
      "review",
      "delivery",
    ]) {
      await navigate(staff, `/staff/cases/${cases.at(-1)}/${tab}`);
      await shot(staff, `${tab}-${width}`);
      await axe(staff, `${tab}-${width}`);
      check(
        `${tab} has no body overflow at ${width}`,
        await staff.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    }
  }
  if (visualQA) {
    await staff.setViewportSize({ width: 1242, height: 668 });
    await navigate(staff, `/staff/cases/${cases.at(-1)}/trail`);
    await staff.locator(".trail-node").first().waitFor();
    await staff.locator(".case-body").evaluate((el) => (el.scrollTop = 0));
    await shot(staff, "trail-reference-1242");
    const count = await staff.locator(".trail-node").count();
    check("Expanded trail renders confirmed bank paths", count >= 4);
    await staff.getByRole("button", { name: "Replay", exact: true }).click();
    await staff.getByRole("button", { name: "Pause", exact: true }).waitFor();
    await staff.getByRole("button", { name: "Pause", exact: true }).click();
    const range = staff.getByRole("slider", {
      name: "Transfer sequence",
      exact: true,
    });
    await range.focus();
    await range.press("Home");
    check(
      "Replay changes transfer visibility without changing backend positions",
      (await staff.locator(".live-graph svg g[opacity='0.15']").count()) > 0,
    );
    await range.press("End");
    await staff.getByRole("button", { name: /^Debit 2/ }).click();
    check(
      "Second debit can be followed",
      (await staff
        .getByRole("button", { name: /^Debit 2/ })
        .getAttribute("aria-pressed")) === "true",
    );
    await staff.locator(".trail-node").last().click();
    await staff
      .getByRole("button", {
        name: "Inspect sources & observation",
        exact: true,
      })
      .click();
    check(
      "Inspector can be reached from selected account",
      await staff
        .locator("#trail-inspector")
        .evaluate((el) => document.activeElement === el),
    );
  }
  check(
    "At least one new case completed a full reviewed handoff",
    fullHandoffs > 0,
  );
  check("No uncaught browser errors", !pageErrors.length);
  await fs.writeFile(
    path.join(out, "acceptance.json"),
    JSON.stringify(
      {
        checks,
        cases,
        pageErrors,
        audits,
        providers,
        decisionStages,
        provider: textEvidence ? "local real worker, literal extraction and bank/feed/receiver simulators; UTF-8 receipts" : "local real worker, OCR and simulators",
        cloudLive: false,
        inputEvidenceMode: textEvidence
          ? "supported UTF-8 receipt from actual bank record"
          : "PNG and UTF-8",
      },
      null,
      2,
    ),
  );
} catch (e) {
  await shot(victim, "failure-victim");
  await shot(staff, "failure-staff");
  await fs.writeFile(
    path.join(out, "acceptance-failure.json"),
    JSON.stringify(
      {
        checks,
        cases,
        error: e.message
          .replace(/(\/customer\/|\/reply\/)[A-Za-z0-9_%.-]+/g, "$1[redacted]")
          .replace(/(cp_demo|cp_victim)=[^;\s]+/g, "$1=[redacted]"),
        pageErrors,
      },
      null,
      2,
    ),
  );
  console.error(
    "FAIL",
    e.message
      .replace(/(\/customer\/|\/reply\/)[A-Za-z0-9_%.-]+/g, "$1[redacted]")
      .replace(/(cp_demo|cp_victim)=[^;\s]+/g, "$1=[redacted]"),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
