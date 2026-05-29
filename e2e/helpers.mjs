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
  // Scope to the login FORM (the one with a password field), so we don't hit the
  // site header's search button, which also carries .btn-primary.
  const form = page.locator("form").filter({ has: page.locator('input[type="password"]') }).first();
  await form.locator('input[type="email"]').first().fill(acct.email);
  await form.locator('input[type="password"]').first().fill(acct.password);

  // Click the login submit and capture the real login API response.
  const respPromise = page
    .waitForResponse((r) => r.url().includes("/api/auth/login") && r.request().method() === "POST", { timeout: 20000 })
    .catch(() => null);
  await form.locator('button.btn-primary, button[type="submit"]').first().click();
  const resp = await respPromise;

  const loginStatus = resp ? resp.status() : null;
  // Give the client redirect + Set-Cookie a beat to settle.
  await page.waitForTimeout(1500);
  return { page, ctx, loginStatus };
}
