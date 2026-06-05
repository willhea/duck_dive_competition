/**
 * Playwright smoke test for the Claude Outages dive (local preview).
 * Tests the render/interaction layer that pytest can't reach.
 *
 * Prereq: dev server running (`npm run dev`). Run: `node smoke.mjs`
 * Exits non-zero if any check fails.
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";

const URL = "http://localhost:5173/";
const checks = [];
const check = async (name, fn) => {
  try { await fn(); checks.push([true, name]); }
  catch (e) { checks.push([false, `${name} — ${e.message}`]); }
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 820, height: 1200 } });
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(e.message));

await page.goto(URL, { waitUntil: "load" });
await page.getByRole("heading", { name: /Three Years of Claude Outages/i }).waitFor({ timeout: 40000 });

await check("KPIs render a real incident count", async () => {
  const txt = await page.locator("p", { hasText: "incidents reported" }).locator("..").locator("p").first().textContent();
  assert.ok(Number(txt.replace(/[^0-9]/g, "")) > 700, `got ${txt}`);
});

await check("Over time chart renders bars", async () => {
  await page.getByRole("button", { name: "Over time" }).click();
  await page.waitForTimeout(1500);
  const bars = await page.locator("svg .recharts-bar-rectangle, svg path.recharts-rectangle").count()
    .catch(() => 0);
  const rects = await page.locator("svg rect").count();
  assert.ok(bars > 0 || rects > 10, `bars=${bars} rects=${rects}`);
});

await check("Legend click toggles a severity series off and on", async () => {
  await page.getByRole("button", { name: "Over time" }).click();
  await page.waitForTimeout(1200);
  const series = () => page.locator("svg .recharts-bar").count();
  assert.equal(await series(), 3, "expected 3 stacked severity series");
  await page.locator(".recharts-legend-item", { hasText: "minor" }).click();
  await page.waitForTimeout(600);
  assert.equal(await series(), 2, "hiding minor should drop a series");
  await page.locator(".recharts-legend-item", { hasText: "minor" }).click();
  await page.waitForTimeout(600);
  assert.equal(await series(), 3, "re-clicking minor should restore it");
});

await check("Recovery-time metric does not crash", async () => {
  await page.getByRole("button", { name: "Recovery time" }).click();
  await page.waitForTimeout(1200);
  assert.ok(await page.locator("svg").count() > 0);
});

await check("Longest incidents lists linked rows", async () => {
  await page.getByRole("button", { name: "Longest incidents" }).click();
  await page.waitForTimeout(1500);
  const links = await page.locator('a[href*="status.claude.com"], a[href*="status.anthropic.com"]').count();
  assert.ok(links >= 5, `got ${links} incident links`);
});

await check("Timezone % recomputes when timezone changes", async () => {
  await page.getByRole("button", { name: "Your timezone" }).click();
  await page.waitForTimeout(2000);
  const pctText = () => page.locator("text=/\\d+% of outages/").first().textContent();
  const eastern = await pctText();
  await page.locator("select").first().selectOption("Pacific/Honolulu");
  await page.waitForTimeout(2000);
  const honolulu = await pctText();
  assert.notEqual(eastern, honolulu, `pct did not change (${eastern} -> ${honolulu})`);
});

await check("World map bands are differentiated and not wrapped", async () => {
  await page.getByRole("button", { name: "World map" }).click();
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => {
    const rs = [...document.querySelectorAll("svg rect")].slice(0, 24);
    return rs.length >= 20 && rs.some((r) => /rgb/.test(r.getAttribute("fill") || ""));
  }, { timeout: 20000 });
  const bands = await page.$$eval("svg rect", (rs) => rs.slice(0, 24).map((r) => ({
    w: Number(r.getAttribute("width")), fill: r.getAttribute("fill"),
  })));
  // regression guard: the UTC+12 date-line wrap produced a full-width covering rect
  assert.ok(bands.every((b) => b.w < 200), "a band rect spans too wide (date-line wrap regression)");
  const distinct = new Set(bands.map((b) => b.fill));
  assert.ok(distinct.size >= 6, `only ${distinct.size} distinct band colors (differentiation lost)`);
});

await check("No console / page errors", async () => {
  assert.equal(consoleErrors.length, 0, consoleErrors.join(" | "));
});

await browser.close();

let failed = 0;
for (const [ok, name] of checks) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
