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
  for (const path of ["/suppliers", "/manufacturers", "/how-it-works"]) {
    const resp = await page.goto(path, { waitUntil: "domcontentloaded" });
    assert.ok(resp && resp.status() < 400, `${path} should not error (got ${resp && resp.status()})`);
  }
  await page.context().close();
});

test("buyer can log in and reach the account page", async () => {
  const { page, ctx, loginStatus } = await loginAs("buyer");
  assert.equal(loginStatus, 200, "buyer login API should return 200");
  await page.goto("/account", { waitUntil: "domcontentloaded" });
  assert.ok(!page.url().includes("/login"), "account must not bounce an authenticated buyer to /login");
  await ctx.close();
});

test("supplier can log in and reach the supplier dashboard + sub-pages", async () => {
  const { page, ctx, loginStatus } = await loginAs("supplier");
  assert.equal(loginStatus, 200, "supplier login API should return 200");
  for (const path of ["/supplier", "/supplier/products", "/supplier/payouts", "/supplier/quotes", "/supplier/settings"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    assert.ok(!page.url().includes("/login"), `${path} must not bounce an authenticated supplier`);
  }
  await ctx.close();
});

test("admin can log in and reach the admin console + key sub-pages", async () => {
  const { page, ctx, loginStatus } = await loginAs("admin");
  assert.equal(loginStatus, 200, "admin login API should return 200");
  for (const path of ["/admin", "/admin/buyer-orgs", "/admin/users", "/admin/accounts-receivable"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    assert.ok(!page.url().includes("/login"), `${path} must not bounce an authenticated admin`);
  }
  await ctx.close();
});

test("search returns catalog results", async () => {
  const page = await newPage();
  await page.goto("/catalog?q=transformer", { waitUntil: "domcontentloaded" });
  const body = (await page.locator("body").innerText()).toLowerCase();
  assert.ok(body.includes("transformer") || body.includes("kva"), "search should surface matching products");
  await page.context().close();
});

test("all legal pages render", async () => {
  const page = await newPage();
  const routes = [
    "/legal/terms",
    "/legal/privacy",
    "/legal/acceptable-use",
    "/legal/returns",
    "/legal/supplier-agreement",
    "/legal/dpa",
    "/legal/security",
    "/legal/subprocessors",
  ];
  for (const path of routes) {
    const resp = await page.goto(path, { waitUntil: "domcontentloaded" });
    assert.ok(resp && resp.status() < 400, `${path} should render (got ${resp && resp.status()})`);
  }
  await page.context().close();
});

test("unknown route returns 404", async () => {
  const page = await newPage();
  const resp = await page.goto("/this-route-does-not-exist-zzz", { waitUntil: "domcontentloaded" });
  assert.equal(resp.status(), 404, "an unknown route should 404");
  await page.context().close();
});

// Cart is client-side localStorage (src/lib/cart.ts, key partsport_cart_v1).
// CBL-CTRL14 is a sub-$3000 in-stock item, so it uses instant checkout (not RFQ).
test("add to cart persists the line and the cart page shows it", async () => {
  const page = await newPage();
  await page.goto("/product/CBL-CTRL14", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Add to cart" }).first().click();
  // localStorage is the cart's source of truth: the bulletproof signal.
  await page.waitForFunction(
    () => (localStorage.getItem("partsport_cart_v1") || "").includes("CBL-CTRL14"),
    { timeout: 8000 }
  );
  await page.goto("/cart", { waitUntil: "domcontentloaded" });
  // CartClient hydrates then fetches product metadata; wait for the line to render.
  await page
    .waitForFunction(() => /Control Cable|14 AWG/i.test(document.body.innerText), { timeout: 10000 })
    .catch(() => {});
  const body = await page.locator("body").innerText();
  assert.ok(/Control Cable|14 AWG/i.test(body), "cart should show the added product");
  await page.context().close();
});

test("checkout page renders for a guest cart in demo mode", async () => {
  const page = await newPage();
  await page.goto("/product/CBL-CTRL14", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Add to cart" }).first().click();
  await page.waitForFunction(
    () => (localStorage.getItem("partsport_cart_v1") || "").includes("CBL-CTRL14"),
    { timeout: 8000 }
  );
  const resp = await page.goto("/checkout", { waitUntil: "domcontentloaded" });
  assert.ok(resp && resp.status() < 400, `checkout should render (got ${resp && resp.status()})`);
  assert.ok(!page.url().includes("/login"), "guest checkout must not require login in demo mode");
  await page.context().close();
});

// NOTE: the RFQ / request-a-quote path is intentionally not covered here because
// no seeded product has quoteOnly=true, so the seed cannot exercise it. It is
// covered by the owner live smoke tests (a real >=$3000 quote-only listing).

test("wrong password does not grant a session", async () => {
  const page = await newPage();
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const form = page.locator("form").filter({ has: page.locator('input[type="password"]') }).first();
  await form.locator('input[type="email"]').first().fill("buyer@partsport.example");
  await form.locator('input[type="password"]').first().fill("wrong-password-xyz");
  await form.locator('button.btn-primary, button[type="submit"]').first().click();
  await page.waitForTimeout(2500);
  // Directly assert the security property: a failed login grants no session, so
  // an auth-gated page bounces to /login (robust regardless of client redirect).
  await page.goto("/account", { waitUntil: "domcontentloaded" });
  assert.ok(page.url().includes("/login"), "a wrong password must not grant access to /account");
  await page.context().close();
});
