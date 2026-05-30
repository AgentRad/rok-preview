import { chromium } from "playwright";
import { promises as fs } from "fs";
import path from "path";

const SITE = "https://rok-preview-git-claude-industrial-marketplace-rowau-agentrad.vercel.app";
const OUT = "/tmp/partsport-pitch";

const DEMO_PASS = "demo1234";
const ACCOUNTS = {
  buyer: "buyer@partsport.example",
  supplier: "supplier@partsport.example",
  admin: "admin@partsport.example",
  oem: "oem@partsport.example",
};

async function login(page, email) {
  await page.goto(`${SITE}/login`, { waitUntil: "networkidle" });
  await page.fill('#email', email);
  await page.fill('#password', DEMO_PASS);
  await Promise.all([
    page.waitForURL(u => !u.toString().includes('/login'), { timeout: 15000 }).catch(() => {}),
    page.click('button.btn-primary'),
  ]);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
}

async function shot(page, url, file, options = {}) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 25000 });
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: path.join(OUT, file),
    fullPage: options.fullPage ?? false,
  });
  console.log(`captured ${file}`);
}

(async () => {
  await fs.mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();

  // Public pages (logged out)
  await shot(page, `${SITE}/`, "01-home.png", { fullPage: true });
  await shot(page, `${SITE}/catalog`, "02-catalog.png");
  await shot(page, `${SITE}/manufacturers`, "03-manufacturers.png");
  await shot(page, `${SITE}/how-it-works`, "04-how-it-works.png", { fullPage: true });
  await shot(page, `${SITE}/suppliers`, "05-suppliers-landing.png", { fullPage: true });

  // Product detail (find a real SKU first)
  await page.goto(`${SITE}/catalog`, { waitUntil: "networkidle" });
  const firstProductHref = await page.locator('a[href^="/product/"]').first().getAttribute("href");
  if (firstProductHref) {
    await shot(page, `${SITE}${firstProductHref}`, "06-product-detail.png");
  }

  // Buyer logged in
  await login(page, ACCOUNTS.buyer);
  await shot(page, `${SITE}/account`, "07-buyer-account.png");

  // Supplier dashboard
  await ctx.clearCookies();
  await login(page, ACCOUNTS.supplier);
  await shot(page, `${SITE}/supplier`, "08-supplier-dashboard.png");

  // Admin dashboard + profit + audit + supplier health
  await ctx.clearCookies();
  await login(page, ACCOUNTS.admin);
  await shot(page, `${SITE}/admin`, "09-admin-overview.png");
  await shot(page, `${SITE}/admin/profit`, "10-admin-profit.png");
  await shot(page, `${SITE}/admin/audit`, "11-admin-audit.png");
  await shot(page, `${SITE}/admin/supplier-health`, "12-admin-supplier-health.png");
  await shot(page, `${SITE}/ops`, "13-ops-fulfillment.png");

  // OEM dashboard
  await ctx.clearCookies();
  await login(page, ACCOUNTS.oem);
  await shot(page, `${SITE}/oem`, "14-oem-dashboard.png");

  await browser.close();
  console.log("\nAll screenshots saved to", OUT);
  const files = await fs.readdir(OUT);
  console.log("Files:", files.sort().join(", "));
})();
