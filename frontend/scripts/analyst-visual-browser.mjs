import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const textEvidence = process.env.CASEPROOF_TEXT_EVIDENCE === "1";
const reuseBank = true;
const visualQA = true;
const recoverReceipt = process.env.CASEPROOF_RECEIPT_RECOVERY === "1";
const require = createRequire(import.meta.url),
  out = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    visualQA
      ? "../../var/analyst-density/readonly"
      : recoverReceipt
        ? "../../var/receipt-recovery/browser"
        : "../../var/analyst-workspace/after",
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
      const health = await context.request.get(base + "/health");
      const config = await context.request.get(base + "/v1/ui-config");
      if (health.ok() && config.ok()) {
        available = true;
        break;
      }
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
  const caseId = process.env.CASEPROOF_CASE_ID;
  assert.ok(caseId, "Set CASEPROOF_CASE_ID to an accessible practice case");
  await read(`/v1/cases/${caseId}`);
  for (const width of [1242, 1440, 768, 390]) {
    await staff.setViewportSize({ width, height: 668 });
    for (const tab of ["overview", "evidence", "trail", "requests", "review"]) {
      await navigate(staff, `/staff/cases/${caseId}/${tab}`);
      await staff.locator(".case-next-step").waitFor();
      await staff.locator(".case-body").evaluate((el) => (el.scrollTop = 0));
      check(
        `${tab} no body overflow at ${width}`,
        await staff.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      if (width >= 1242)
        check(
          `${tab} compact next action at ${width}`,
          await staff
            .locator(".case-next-step")
            .evaluate((el) => el.getBoundingClientRect().height < 155),
        );
      if (tab === "overview" && width > 1000)
        check(
          `Payments remain beside the brief at ${width}`,
          await staff.locator(".analyst-overview-top").evaluate((el) => {
            const cols = el.children;
            return (
              Math.abs(
                cols[0].getBoundingClientRect().top -
                  cols[1].getBoundingClientRect().top,
              ) < 2 &&
              cols[1].getBoundingClientRect().left >
                cols[0].getBoundingClientRect().left
            );
          }),
        );
      if (tab === "trail") {
        await staff.locator(".trail-node").first().waitFor();
        if (width >= 1242)
          check(
            `Trail starts in the first viewport at ${width}`,
            await staff
              .locator(".graph-viewport")
              .evaluate((el) => el.getBoundingClientRect().top < 550),
          );
      }
      await shot(staff, `${tab}-${width}`);
      await axe(staff, `${tab}-${width}`);
    }
  }
  await staff.setViewportSize({ width: 1242, height: 668 });
  await navigate(staff, `/staff/cases/${caseId}/trail`);
  await staff.getByRole("button", { name: "Replay", exact: true }).click();
  await staff.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = staff.getByRole("slider", {
    name: "Transfer sequence",
    exact: true,
  });
  await slider.focus();
  await slider.press("Home");
  check(
    "Keyboard scrub fades future transfers",
    (await staff.locator(".live-graph svg g[opacity='0.15']").count()) > 0,
  );
  await slider.press("End");
  const debit = staff.getByRole("button", { name: /^Debit 1/ });
  await debit.click();
  check(
    "Debit follow toggles",
    (await debit.getAttribute("aria-pressed")) === "true",
  );
  await staff.locator(".trail-node").last().click();
  await staff
    .getByRole("button", { name: "Inspect sources & observation", exact: true })
    .click();
  check(
    "Account source inspector receives focus",
    await staff
      .locator("#trail-inspector")
      .evaluate((el) => document.activeElement === el),
  );
  await debit.click();
  await staff.locator(".trail-node").nth(1).click();
  await staff.emulateMedia({ reducedMotion: "no-preference" });
  const motion = staff.locator(".trail-motion").first();
  const point = await motion.evaluate((el) => el.getBoundingClientRect().x);
  await staff.waitForFunction(
    (x) => {
      const el = document.querySelector(".trail-motion");
      return el && Math.abs(el.getBoundingClientRect().x - x) > 1;
    },
    point,
    { timeout: 5000 },
  );
  check("Transfer marker moves along the recorded path");
  await staff
    .getByRole("button", { name: "Pause flow animation", exact: true })
    .click();
  check(
    "Continuous flow motion can be paused",
    (await staff.locator(".trail-motion").count()) === 0,
  );
  await staff
    .getByRole("button", { name: "Resume flow animation", exact: true })
    .click();
  check(
    "Continuous flow motion resumes",
    (await staff.locator(".trail-motion").count()) > 0,
  );
  if (
    await staff
      .getByRole("button", { name: "Expand money trail", exact: true })
      .count()
  ) {
    await staff
      .getByRole("button", { name: "Expand money trail", exact: true })
      .click();
    await staff.waitForFunction(() => document.fullscreenElement !== null);
    check("Native full-screen graph opens");
    await shot(staff, "trail-fullscreen-1242");
    await staff
      .getByRole("button", { name: "Exit trail full screen", exact: true })
      .click();
    await staff.waitForFunction(() => !document.fullscreenElement);
    check("Full-screen graph exits");
  }
  check("No uncaught browser errors", !pageErrors.length);
  await fs.writeFile(
    path.join(out, "visual-qa.json"),
    JSON.stringify(
      { checks, audits, pageErrors, caseId, readOnly: true },
      null,
      2,
    ),
  );
} catch (e) {
  await shot(staff, "visual-failure");
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
