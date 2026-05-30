import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("file:///tmp/partsport-pitch/index.html", { waitUntil: "networkidle" });
await page.pdf({
  path: "/tmp/partsport-pitch/PartsPort-Pitch.pdf",
  format: "Letter",
  printBackground: true,
  margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
});
await browser.close();
console.log("PDF saved");
