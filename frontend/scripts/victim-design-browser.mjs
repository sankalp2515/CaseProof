import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const out = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../var/victim-design/final",
);
const base = process.env.CASEPROOF_BASE_URL || "http://127.0.0.1:8208";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await ctx.newPage();
page.setDefaultTimeout(90000);
const checks = [],
  audits = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const check = (name, value) => {
  assert.ok(value, name);
  checks.push(name);
  console.log("PASS", name);
};
async function top() {
  await page.locator(".victim-app").evaluate((el) => (el.scrollTop = 0));
}
async function shot(name) {
  await top();
  await page.screenshot({ path: path.join(out, name + ".png") });
}
async function audit(name) {
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
  assert.equal(violations.length, 0, name + " accessibility");
}
async function fit(name) {
  check(
    name + " fits viewport",
    await page
      .locator(".victim-app")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  );
}
async function responsive(name) {
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await shot(`${name}-${width}`);
    await fit(`${name}-${width}`);
    await audit(`${name}-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
try {
  await page.goto(base + "/app/#/victim/start");
  await page.locator(".customer-option").first().waitFor();
  await shot("start-desktop");
  await audit("start-desktop");
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await shot("start-" + width);
    await fit("start-" + width);
    await audit("start-" + width);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(".customer-option:has(.incident-hint)").first().click();
  await page
    .getByRole("button", { name: "Continue with selected customer" })
    .click();
  await page
    .getByRole("button", { name: "Report a payment scam", exact: true })
    .waitFor();
  await shot("home-desktop");
  await audit("home-desktop");
  await page
    .getByRole("button", { name: "Report a payment scam", exact: true })
    .click();
  await page.locator(".select-payment").first().waitFor();
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await page.keyboard.press("Enter");
  check(
    "Skip link preserves the report route",
    page.url().endsWith("/victim/report"),
  );
  check(
    "Skip link focuses main",
    await page.locator("main").evaluate((el) => el === document.activeElement),
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  check(
    "Missing payment is explained without advancing",
    await page.getByRole("alert").isVisible(),
  );
  await page.getByRole("checkbox", { name: /Dispute payment .*-T1$/ }).check();
  await shot("payments-desktop");
  await audit("payments-desktop");
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await shot("payments-" + width);
    await fit("payments-" + width);
    await audit("payments-" + width);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  check(
    "Step change focuses narrative heading",
    await page
      .locator('[data-tour="report-narrative"]')
      .evaluate((el) => el === document.activeElement),
  );
  await page
    .getByRole("textbox", { name: "What happened?", exact: true })
    .fill(
      "A caller claimed to be from my bank and asked me to transfer money to a safe account. I made the selected payment, then realised the caller was impersonating bank support.",
    );
  await shot("narrative-desktop");
  await audit("narrative-desktop");
  await responsive("narrative");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  for (const name of [
    "Create synthetic receipt",
    "Create synthetic chat",
    "Create synthetic call log",
  ]) {
    const before = await page.locator(".upload-row").count();
    await page.getByRole("button", { name, exact: true }).click();
    await page.waitForFunction(
      (n) => document.querySelectorAll(".upload-row").length > n,
      before,
    );
  }
  check(
    "Three real sample evidence files are attached",
    (await page.locator(".upload-row").count()) === 3,
  );
  await shot("evidence-desktop");
  await audit("evidence-desktop");
  await responsive("evidence");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await shot("review-desktop");
  await audit("review-desktop");
  await responsive("review");
  await page
    .getByRole("button", { name: "Submit report", exact: true })
    .click();
  await page.waitForURL(/victim\/complaints\/CASE-/);
  const caseId = page.url().split("/").at(-1);
  await page
    .getByRole("heading", { name: "Report registered", exact: true })
    .waitFor();
  await shot("confirmation-desktop");
  await audit("confirmation-desktop");
  check("Report registered with the real backend", caseId.startsWith("CASE-"));
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await shot("confirmation-" + width);
    await fit("confirmation-" + width);
    await audit("confirmation-" + width);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  // A minimised tour must not cover the newly highlighted header handoff.
  await page.getByRole("button", { name: "Tour", exact: true }).click();
  await page
    .getByRole("button", { name: "Minimise guidance", exact: true })
    .click();
  await page.goto(base + "/app/#/victim/complaints/" + caseId);
  await page.locator("header .demo-handoff-button").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  check(
    "Minimised tour resumes inside the victim header",
    (await page.locator("header #victim-tour-slot button").count()) === 1,
  );
  check(
    "Mobile analyst handoff is not covered",
    await page.locator("header .demo-handoff-button").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
      );
    }),
  );
  await shot("header-handoff-resume-mobile");
  await audit("header-handoff-resume-mobile");
  await page.getByRole("button", { name: /Show guidance/ }).click();
  await page.getByRole("button", { name: "Close tour", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Continue as analyst demo", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Payment inventory", exact: true })
    .waitFor();
  check("Analyst handoff opens the same report", page.url().includes(caseId));
  await page.goto(base + "/app/#/victim/reply/invalid-preview-link");
  await page.getByRole("alert").waitFor();
  await shot("expired-link");
  check(
    "Invalid reply links show a recoverable error",
    await page.getByRole("alert").isVisible(),
  );
  await audit("expired-link");
  check("No uncaught browser errors", errors.length === 0);
  await fs.writeFile(
    path.join(out, "results.json"),
    JSON.stringify(
      {
        base,
        checks,
        audits,
        errors,
        caseId,
        environment:
          "isolated local backend, OCR and simulators; deployed cloud provider unchanged",
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
