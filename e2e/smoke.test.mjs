// End-to-end smoke tests against a real running app + Postgres (CI boots both).
// Covers the safe, no-external-service journeys: public pages render with seeded
// data, auth round-trips work per role, and role-gated dashboards load. The
// payment/SSO/email/webhook paths stay as owner live smoke tests (they need real
// Stripe/IdP/inbox), per docs/OWNER_SMOKE_TESTS.md.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, close, newPage, loginAs, BASE_URL } from "./helpers.mjs";

before(async () => {
  await launch();
});
after(async () => {
  await close();
});

async function textOf(page) {
  return (await page.locator("body").innerText()).toLowerCase();
}

test("homepage renders with categories", async () => {
  const page = await newPage();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  assert.match(await page.title(), /PartsPort/i);
  const body = await textOf(page);
  assert.ok(body.includes("transformers"), "expected a product category on the homepage");
  await page.context().close();
});

test("catalog lists seeded products", async () => {
  const page = await newPage();
  await page.goto("/catalog", { waitUntil: "domcontentloaded" });
  const body = await textOf(page);
  assert.ok(
    body.includes("transformer") || body.includes("circuit breaker") || body.includes("kva"),
    "expected seeded catalog content"
  );
  await page.context().close();
});

test("product detail page renders a seeded SKU", async () => {
  const page = await newPage();
  await page.goto("/product/TXF-PM75", { waitUntil: "domcontentloaded" });
  const body = await textOf(page);
  assert.ok(body.includes("pad-mount") || body.includes("transformer"), "expected the seeded product");
  await page.context().close();
});

test("login page shows the form", async () => {
  const page = await newPage();
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  assert.equal(await page.locator('input[type="email"]').count() >= 1, true);
  assert.equal(await page.locator('input[type="password"]').count() >= 1, true);
  await page.context().close();
});

test("register page shows the form", async () => {
  const page = await newPage();
  await page.goto("/register", { waitUntil: "domcontentloaded" });
  assert.equal(await page.locator('input[type="email"]').count() >= 1, true);
  await page.context().close();
});

test("marketing pages render", async () => {
  const page = await newPage();
  for (const path of ["/for-suppliers", "/for-manufacturers", "/how-it-works"]) {
    const resp = await page.goto(path, { waitUntil: "domcontentloaded" });
    assert.ok(resp && resp.status() < 400, `${path} should not error (got ${resp && resp.status()})`);
  }
  await page.context().close();
});

test("buyer can log in and reach the account page", async () => {
  const { page, ctx } = await loginAs("buyer");
  await page.goto("/account", { waitUntil: "domcontentloaded" });
  assert.ok(!page.url().includes("/login"), "account must not bounce an authenticated buyer to /login");
  await ctx.close();
});

test("supplier can log in and reach the supplier dashboard", async () => {
  const { page, ctx } = await loginAs("supplier");
  await page.goto("/supplier", { waitUntil: "domcontentloaded" });
  assert.ok(!page.url().includes("/login"), "supplier dashboard must not bounce an authenticated supplier");
  const body = (await page.locator("body").innerText()).toLowerCase();
  assert.ok(body.length > 0, "supplier dashboard rendered");
  await ctx.close();
});

test("admin can log in and reach the admin console", async () => {
  const { page, ctx } = await loginAs("admin");
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  assert.ok(!page.url().includes("/login"), "admin console must not bounce an authenticated admin");
  await ctx.close();
});

test("wrong password is rejected", async () => {
  const page = await newPage();
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').first().fill("buyer@partsport.example");
  await page.locator('input[type="password"]').first().fill("wrong-password-xyz");
  await page.locator('button[type="submit"], button.btn-primary').first().click();
  // Should stay on /login (no session). Give it a beat to NOT navigate away.
  await page.waitForTimeout(2500);
  assert.ok(page.url().includes("/login"), "a wrong password must not log the user in");
  await page.context().close();
});
