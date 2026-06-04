import { chromium } from "playwright";

const URL = "http://localhost:5173/";
const tab = process.argv[2] || "World map";
const out = process.argv[3] || "/tmp/dive.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 820, height: 1100 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

await page.goto(URL, { waitUntil: "load" });
// wait for the dive to connect + render
await page.getByRole("heading", { name: /Three Years of Claude Outages/i }).waitFor({ timeout: 40000 });

if (tab) {
  await page.getByRole("button", { name: tab }).click();
  await page.waitForTimeout(2000);
}

// For the world map, wait until band rects actually have a saturated (non-gray) fill
if (tab === "World map") {
  await page.waitForFunction(() => {
    const rs = [...document.querySelectorAll("svg rect")].slice(0, 24);
    if (rs.length < 24) return false;
    return rs.some((r) => {
      const f = r.getAttribute("fill") || "";
      const m = f.match(/rgb\((\d+), (\d+), (\d+)\)/);
      return m && Number(m[1]) > 200 && Number(m[2]) < 80; // a strong red
    });
  }, { timeout: 30000 }).catch(() => console.log("WARN: bands never got strong fill"));
  await page.waitForTimeout(500);
}

await page.screenshot({ path: out, fullPage: true });

// pull a quick read of the rendered band fills if present
const bandFills = await page.$$eval("svg rect", (rs) =>
  rs.slice(0, 24).map((r) => r.getAttribute("fill"))).catch(() => []);

console.log("screenshot:", out);
console.log("console/page errors:", errors.length ? errors : "none");
console.log("first band fills:", JSON.stringify(bandFills));
await browser.close();
