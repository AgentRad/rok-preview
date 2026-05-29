// Shared e2e helpers. Uses the already-installed `playwright` core package
// (NOT @playwright/test, which is not a dependency) driven by Node's built-in
// `node --test` runner, matching the repo's existing zero-dep test pattern.
import { chromium } from "playwright";

export const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

let browser;

export async function launch() {
  browser = await chromium.launch();
  return browser;
}

export async function close() {
  if (browser) await browser.close();
}

export async function newPage() {
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  return page;
}

// Demo accounts seeded by prisma/seed.mjs (password demo1234).
export const ACCOUNTS = {
  buyer: { email: "buyer@partsport.example", password: "demo1234" },
  supplier: { email: "supplier@partsport.example", password: "demo1234" },
  admin: { email: "admin@partsport.example", password: "demo1234" },
  oem: { email: "oem@partsport.example", password: "demo1234" },
};

// Logs in via the real /login form and returns the authenticated page+context.
// Asserts success by confirming /account does NOT bounce back to /login.
export async function loginAs(role) {
  const acct = ACCOUNTS[role];
  if (!acct) throw new Error(`unknown role ${role}`);
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').first().fill(acct.email);
  await page.locator('input[type="password"]').first().fill(acct.password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 }),
    page.locator('button[type="submit"], button.btn-primary').first().click(),
  ]);
  return { page, ctx };
}
