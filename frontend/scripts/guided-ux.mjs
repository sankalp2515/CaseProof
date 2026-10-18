import { chromium } from "playwright";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  out = process.env.CASEPROOF_QA_OUTPUT
    ? process.env.CASEPROOF_QA_OUTPUT.replace(/[\\/]?$/, "/")
    : fileURLToPath(new URL("../../var/ux-repair/", import.meta.url));
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1242, height: 668 },
  reducedMotion: "reduce",
});
const p = await context.newPage(),
  desk = await context.newPage(),
  answers = await context.newPage();
p.setDefaultTimeout(90000);
desk.setDefaultTimeout(90000);
answers.setDefaultTimeout(90000);
const base = process.env.CASEPROOF_BASE_URL || "http://127.0.0.1:8188",
  checks = [],
  audits = [],
  errors = [];
for (const page of [p, desk, answers])
  page.on("pageerror", (e) => errors.push(e.message));
p.on("response", (r) => {
  if (r.url().endsWith("/v1/victim/sample-evidence"))
    console.log("SAMPLE", r.request().method(), r.status());
});
p.on("requestfinished", (r) => {
  if (r.url().endsWith("/v1/victim/sample-evidence"))
    console.log("SAMPLE FINISHED", r.method());
});
const check = (name, ok = true) => {
  assert.ok(ok, name);
  checks.push(name);
  console.log("PASS", name);
};
const api = async (route) => {
  const r = await context.request.get(base + route, {
    headers: { "X-Demo-User": "analyst" },
  });
  assert.equal(r.status(), 200, route);
  return r.json();
};
async function shot(page, name) {
  await page.screenshot({ path: out + name + ".png" });
}
async function axe(page, name) {
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    const r = await axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
      },
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      targets: v.nodes.map((n) => n.target),
    }));
  });
  audits.push({ name, violations });
  console.log("AXE", name, violations.length);
}
async function stage(n) {
  await p
    .locator(".tour-count")
    .getByText(n + " / 12", { exact: true })
    .waitFor({ timeout: 30000 });
  if (process.env.TOUR_SHOTS) {
    // Opt-in review aid: what the visitor reads and sees at each highlight.
    await p.waitForTimeout(1200);
    await p.screenshot({ path: out + "tour-step-" + n + ".png" });
    const card = await p
      .locator(".tour-body")
      .innerText()
      .catch(() => "");
    console.log("STEP", n, JSON.stringify(card.replace(/\s+/g, " ")));
  }
  const box = await p.locator(".tour-footer").boundingBox();
  check(
    "Tour " + n + " actions inside 668px viewport",
    box.y >= 0 && box.y + box.height <= 668,
  );
}
async function minimise() {
  await p
    .getByRole("button", { name: "Minimise guidance", exact: true })
    .click();
}
async function restore() {
  await p.getByRole("button", { name: /Show guidance/ }).click();
}
async function settled(cid) {
  for (let i = 0; i < 90; i++) {
    const w = await api(`/v1/cases/${cid}/workflow`);
    if (
      !w.bank_data_refresh_required &&
      !["queued", "running"].includes(w.job?.status) &&
      w.status !== "processing"
    ) {
      assert.notEqual(w.job?.status, "failed");
      return w;
    }
    await p.waitForTimeout(1500);
  }
  throw Error("Worker did not settle");
}
try {
  for (const width of [1242, 627, 390]) {
    await desk.setViewportSize({ width, height: 668 });
    await desk.goto(base + "/app/#/staff/queue");
    await desk.getByLabel("Filter cases").waitFor();
    const fits = await desk.locator(".search").evaluate((e) => {
      const a = e.getBoundingClientRect(),
        b = e.querySelector("input").getBoundingClientRect();
      return (
        b.top >= a.top &&
        b.bottom <= a.bottom &&
        getComputedStyle(e.querySelector("input")).margin === "0px"
      );
    });
    check("Search is a single aligned control at " + width, fits);
    await shot(desk, "after-queue-" + width);
    if (width === 1242) {
      const sameLeft = await desk
        .locator(".persona-label")
        .evaluate(
          (e) =>
            Math.abs(
              e.getBoundingClientRect().left -
                e.querySelector("select").getBoundingClientRect().left,
            ) < 1,
        );
      check("Identity caption and select share a left edge", sameLeft);
    }
  }
  await desk.setViewportSize({ width: 1242, height: 668 });
  await desk.goto(base + "/app/#/staff/cases");
  await desk.getByRole("columnheader", { name: "Delivery history" }).waitFor();
  check(
    "Cases is an all-session history register, not duplicate KPIs",
    (await desk.getByText("Golden-hour priority", { exact: true }).count()) ===
      0,
  );
  await shot(desk, "case-register");
  await axe(desk, "case-register");
  await p.goto(base + "/app/#/victim/start");
  await p.getByRole("button", { name: "Tour", exact: true }).click();
  check(
    "Tour keeps the landing destination",
    p.url().endsWith("/victim/start"),
  );
  await stage(1);
  await p.getByRole("button", { name: /^Next/ }).click();
  await stage(2);
  check(
    "Tour cannot jump past incomplete intake",
    await p.getByRole("button", { name: /^Next/ }).isDisabled(),
  );
  await shot(p, "tour-bounded-1242");
  for (const [width, height] of [
    [627, 668],
    [390, 668],
    [1242, 400],
  ]) {
    await p.setViewportSize({ width, height });
    await p.waitForTimeout(350);
    const r = await p.locator(".tour-footer").boundingBox();
    check(
      "Tour footer accessible at " + width + "x" + height,
      r.y >= 0 && r.y + r.height <= height,
    );
    await shot(p, "tour-" + width + "x" + height);
  }
  await p.setViewportSize({ width: 1242, height: 668 });
  await minimise();
  const fresh = p.waitForResponse(
    (r) =>
      r.url().endsWith("/v1/victim/demo-session") &&
      r.request().method() === "POST",
    { timeout: 180000 },
  );
  await p
    .getByRole("button", { name: "Start a fresh practice session" })
    .click();
  assert.equal((await fresh).status(), 200);
  await p
    .locator(".customer-option:has(.incident-hint)")
    .first()
    .waitFor({ timeout: 90000 });
  await p.waitForFunction(
    () => !document.querySelector(".customer-option")?.disabled,
  );
  await p.locator(".customer-option:has(.incident-hint)").first().click();
  await p
    .getByRole("button", { name: "Continue with selected customer" })
    .click();
  await p.waitForURL(/victim\/home/);
  const me = await api("/v1/victim/me"),
    tx = me.transactions.find((t) => t.txn_id.endsWith("-T1"));
  assert.ok(tx);
  check(
    "Selected scam victim has compact bank-backed practice payee",
    tx.payee.startsWith("narmada.traders.") && tx.payee.length < 50,
  );
  await desk.goto(base + "/app/#/staff/queue");
  await desk
    .getByText("No complaints in this practice session", { exact: true })
    .waitFor({ timeout: 90000 });
  await p
    .getByRole("button", { name: "Report a payment scam", exact: true })
    .click();
  await p
    .getByRole("checkbox", {
      name: "Dispute payment " + tx.txn_id,
      exact: true,
    })
    .waitFor();
  const paymentTimes = await p
    .locator(".select-payment .payment-row small.muted:not(.mono)")
    .allTextContents();
  check(
    "Payment selector describes newest-first ordering",
    await p.getByText("Newest payments first.", { exact: false }).isVisible(),
  );
  await p
    .getByRole("checkbox", {
      name: "Dispute payment " + tx.txn_id,
      exact: true,
    })
    .check();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await restore();
  await stage(3);
  await minimise();
  await p
    .getByRole("textbox", { name: "What happened?", exact: true })
    .fill(
      `The person said he is from the bank and wants me to transfer money to a safe account, so I paid ${tx.amount_minor / 100} to him. I now believe this was a scam.`,
    );
  await p.getByRole("combobox").selectOption("deceived");
  const later = new Date(Date.parse(tx.ts) + 5 * 60000),
    local = new Date(later.getTime() - later.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  await p
    .getByLabel(
      "When did the caller first contact you? (optional, local time)",
      { exact: true },
    )
    .fill(local);
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  check(
    "After-payment contact time requires explicit confirmation",
    await p
      .getByText(
        "Check the first contact time, or confirm it is accurate below.",
        { exact: true },
      )
      .isVisible(),
  );
  await p
    .getByRole("checkbox", {
      name: "Keep this contact time as reported",
      exact: true,
    })
    .check();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await restore();
  await stage(4);
  await minimise();
  // Local stacks have no Gemini and must explain it; cloud offers the AI option.
  const aiOption = await p
    .getByRole("checkbox", { name: "Use AI to write the fictional example" })
    .count();
  check(
    "AI example option matches the configured provider",
    aiOption > 0 ||
      (await p
        .getByText("AI writing is unavailable for the configured provider", {
          exact: false,
        })
        .isVisible()),
  );
  // Hold only the real POST response until the busy-state assertions finish.
  // The backend still generates the actual image; no response data is fabricated.
  let sampleGate;
  await p.route("**/v1/victim/sample-evidence", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    await sampleGate;
    await route.fulfill({ response });
  });
  for (const kind of ["receipt", "chat", "call log"]) {
    let release;
    sampleGate = new Promise((resolve) => {
      release = resolve;
    });
    await p
      .getByRole("button", { name: "Create synthetic " + kind, exact: true })
      .click();
    try {
      await p
        .getByRole("button", { name: `Creating ${kind}…`, exact: true })
        .waitFor();
      check(
        `Only ${kind} shows generation progress`,
        (await p
          .locator('.sample-evidence button[aria-busy="true"]')
          .count()) === 1,
      );
      for (const other of ["receipt", "chat", "call log"].filter(
        (value) => value !== kind,
      )) {
        check(
          `${other} keeps its label while ${kind} generates`,
          await p
            .getByRole("button", {
              name: "Create synthetic " + other,
              exact: true,
            })
            .isDisabled(),
        );
      }
      if (kind === "receipt") await shot(p, "single-sample-progress");
    } finally {
      release();
    }
    await p
      .getByRole("button", { name: "Create synthetic " + kind, exact: true })
      .waitFor({ state: "visible", timeout: 90000 });
  }
  await shot(p, "practice-evidence");
  await axe(p, "practice-evidence");
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await restore();
  await p
    .getByRole("heading", {
      name: "Review and submit your report",
      exact: true,
    })
    .waitFor();
  await p.waitForTimeout(31000);
  check(
    "Review remains a valid tour stage after the old warning timeout",
    (await p
      .getByText(/This panel is not on the current screen yet/)
      .count()) === 0,
  );
  await shot(p, "tour-review-wait");
  await minimise();
  await p.getByRole("button", { name: "Back", exact: true }).click();
  await restore();
  await p
    .getByRole("heading", { name: "Attach the bank receipt", exact: true })
    .waitFor();
  check(
    "Guidance follows Back from Review to Evidence",
    (await p
      .getByText(/This panel is not on the current screen yet/)
      .count()) === 0,
  );
  await p
    .locator(".tour-card")
    .getByRole("button", { name: "Back", exact: true })
    .click();
  await stage(3);
  check(
    "Tour Back opens the narrative without losing it",
    (
      await p
        .getByRole("textbox", { name: "What happened?", exact: true })
        .inputValue()
    ).length > 5,
  );
  await minimise();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await restore();
  await stage(4);
  await minimise();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p.getByRole("button", { name: "Submit report", exact: true }).click();
  await p.waitForURL(/victim\/complaints\/CASE-/, { timeout: 90000 });
  const cid = p.url().split("/").at(-1);
  await restore();
  await stage(5);
  await p
    .locator(".tour-card")
    .getByRole("button", { name: "Back", exact: true })
    .click();
  await p
    .getByRole("heading", {
      name: "Your report is already submitted",
      exact: true,
    })
    .waitFor();
  check(
    "Back after submission preserves the report instead of seeking an absent form",
    (await p
      .getByText(/This panel is not on the current screen yet/)
      .count()) === 0,
  );
  await p.locator(".tour-card").getByRole("button", { name: /Next/ }).click();
  await stage(5);
  await minimise();
  await p
    .locator("header")
    .getByRole("button", { name: "Continue as analyst demo", exact: true })
    .waitFor();
  check(
    "Analyst handoff is highlighted in the header",
    (await p.locator("header .demo-handoff-button").count()) === 1,
  );
  check(
    "Victim receipt no longer contains a staff handoff button",
    (await p.locator(".receipt-status button").count()) === 0,
  );
  await p
    .getByRole("complementary", { name: "Demo journey next step" })
    .waitFor();
  await shot(p, "report-handoff-header");
  await axe(p, "report-handoff-header");
  await p.setViewportSize({ width: 390, height: 844 });
  await shot(p, "report-handoff-mobile");
  await axe(p, "report-handoff-mobile");
  await p.getByRole("button", { name: "Dismiss analyst guidance" }).click();
  check(
    "Dismissing the hint keeps the header handoff available",
    await p.locator("header .demo-handoff-button").isVisible(),
  );
  await p.setViewportSize({ width: 1242, height: 668 });
  await desk
    .getByRole("status", { name: "Golden-hour priority alert", exact: true })
    .waitFor({ timeout: 30000 });
  check(
    "Golden-hour case triggers reference-style alert on open analyst queue",
  );
  await shot(desk, "golden-hour-alert");
  await axe(desk, "golden-hour-alert");
  const raw = await api(`/v1/cases/${cid}`);
  check(
    "Bank-selected alert amount is sourced before OCR",
    (await api("/v1/workspace?scope=active")).cases.find(
      (c) => c.case_id === cid,
    ).selected_bank_amount_minor === tx.amount_minor,
  );
  check(
    "First contact does not replace the bank debit clock",
    Math.abs(Date.parse(raw.clock.first_debit_at) - Date.parse(tx.ts)) < 1000,
  );
  await p
    .getByRole("button", { name: "Continue as analyst demo", exact: true })
    .click();
  await p.waitForURL(/staff\/cases/);
  await restore();
  await p.getByRole("button", { name: /^Next/ }).click();
  await stage(6);
  await minimise();
  await settled(cid);
  await p
    .getByRole("heading", { name: "Payment inventory", exact: true })
    .waitFor();
  const a = await api(`/v1/cases/${cid}`);
  check(
    "New realistic handle survives actual OCR and matching",
    a.ledger_matches.some((m) => m.txn_id === tx.txn_id) &&
      !a.gaps.some((g) => g.required_fact === "readable_receipt"),
  );
  const laterButton = p.getByRole("button", { name: "Later", exact: true });
  if (await laterButton.count()) await laterButton.click();
  check(
    "Role distinction is visible without opening a separate guide",
    await p
      .getByText("Analyst investigates · Reviewer approves — role guide", {
        exact: true,
      })
      .isVisible(),
  );
  await restore();

  await p.getByRole("button", { name: /^Next/ }).click();
  await stage(7);
  await p.getByRole("button", { name: /^Next/ }).click();
  await stage(8);
  await minimise();
  await p.locator(".trail-node").nth(3).waitFor();
  await shot(p, "guided-money-trail");
  await restore();
  await p.getByRole("button", { name: /^Next/ }).click();
  await stage(9);
  await minimise();
  await answers.goto(base + `/app/#/victim/complaints/${cid}`);
  const deny = answers.getByRole("button", {
    name: "No, this payment is unrelated",
    exact: true,
  });
  await deny.first().waitFor({ timeout: 30000 });
  await deny.first().click();
  await answers
    .getByRole("button", { name: "Confirm unrelated payment", exact: true })
    .click();
  await settled(cid);
  await restore();
  await p.getByRole("button", { name: /^Next/ }).click();
  await stage(10);
  await minimise();
  await p
    .getByRole("textbox", { name: "Reviewer rationale", exact: true })
    .fill(
      "Checked bank evidence, receipt, chat and call log. Customer excluded unrelated debit.",
    );
  check(
    "Analyst cannot approve the handoff",
    await p
      .getByRole("button", { name: "Review complete handoff", exact: true })
      .isDisabled(),
  );
  await p
    .getByRole("combobox", { name: "Staff persona", exact: true })
    .selectOption("reviewer");
  await p
    .getByRole("textbox", { name: "Reviewer rationale", exact: true })
    .fill(
      "Independent review of current bank-matched payment, cited receipt and excluded debit. Approve this supported synthetic revision only.",
    );
  await p
    .getByRole("button", { name: "Review complete handoff", exact: true })
    .click();
  await p.getByRole("button", { name: /Approve revision / }).click();
  await restore();
  await p.getByRole("button", { name: /^Next/ }).click();
  await stage(11);
  await minimise();
  await p
    .getByRole("button", {
      name: "Review & send approved reports",
      exact: true,
    })
    .click();
  await p.getByRole("button", { name: "Confirm send", exact: true }).click();
  let w;
  for (let i = 0; i < 90; i++) {
    w = await api(`/v1/cases/${cid}/workflow`);
    if (new Set(w.historical_deliveries.map((d) => d.kind)).size === 2) break;
    await p.waitForTimeout(1000);
  }
  check(
    "Guided case reaches both actual simulator acknowledgements",
    new Set(w.historical_deliveries.map((d) => d.kind)).size === 2,
  );
  await p
    .getByRole("combobox", { name: "Staff persona", exact: true })
    .selectOption("analyst");
  await p
    .getByRole("textbox", { name: "Owner", exact: true })
    .fill("Cedar response team");
  await p
    .getByRole("textbox", { name: "Next action", exact: true })
    .fill("Track receiving institution response.");
  await p
    .getByRole("textbox", { name: "Assignment reason", exact: true })
    .fill("Both receivers acknowledged the handoff.");
  await p.getByRole("button", { name: "Save follow-up", exact: true }).click();
  await restore();
  await p.getByRole("button", { name: /^Next/ }).click();
  await stage(12);
  await p.getByRole("button", { name: "Finish", exact: true }).waitFor();
  await p.waitForFunction(() =>
    Array.from(document.querySelectorAll(".tour-footer button")).some(
      (b) => b.textContent.trim() === "Finish" && !b.disabled,
    ),
  );
  check("Tour Finish requires the actual completed handoff and ownership");
  await shot(p, "guided-handoff-complete");
  await p.getByRole("button", { name: "Finish", exact: true }).click();
  check(
    "Tour ends after real handoff without uncaught UI errors",
    errors.length === 0,
  );
  await fs.writeFile(
    out + "guided-results.json",
    JSON.stringify(
      {
        checks,
        audits,
        errors,
        caseId: cid,
        providers: "Tesseract + local rules; samples bank-simulator",
        liveGoogle: false,
      },
      null,
      2,
    ),
  );
} catch (e) {
  await shot(p, "guided-failure");
  await fs.writeFile(
    out + "guided-failure.json",
    JSON.stringify({ checks, audits, errors, error: e.message }, null, 2),
  );
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
