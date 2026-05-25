// Buyer POV E2E test for PartsPort
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE =
  "https://rok-preview-git-claude-industrial-marketplace-rowau-agentrad.vercel.app";
const SHOTS = "C:/Users/radfe/rok-preview/test-runs/screenshots/buyer";
const EMAIL = "buyer@partsport.example";
const PASS = "demo1234";

mkdirSync(SHOTS, { recursive: true });

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const steps = [];

function record(name, status, notes) {
  steps.push({ name, status, notes });
  console.log(`[${status}] ${name} — ${notes || ""}`);
}

async function shot(page, n) {
  try {
    await page.screenshot({ path: join(SHOTS, n), fullPage: true });
  } catch (e) {
    console.log("screenshot err", n, e.message);
  }
}

async function safe(name, fn) {
  try {
    const result = await fn();
    record(name, "PASS", result || "");
    return result;
  } catch (e) {
    record(name, "FAIL", String(e.message).split("\n")[0]);
    return null;
  }
}

async function dismissDemoGuide(page) {
  // Try clicking the close button if visible; else just set localStorage
  try {
    await page.evaluate(() => {
      try {
        localStorage.setItem("partsport_demo_guide_v1", "1");
      } catch {}
    });
  } catch {}
  try {
    const close = page.locator(".dg-close").first();
    if ((await close.count()) > 0 && (await close.isVisible())) {
      await close.click({ timeout: 2000 });
    }
  } catch {}
  try {
    const overlay = page.locator(".dg-overlay").first();
    if ((await overlay.count()) > 0 && (await overlay.isVisible())) {
      await overlay.click({ position: { x: 5, y: 5 }, timeout: 2000 });
    }
  } catch {}
}

const browser = await chromium.launch({
  headless: false,
  slowMo: 300,
  channel: "chrome",
});
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 900 },
});

// Pre-set demo-guide localStorage so the overlay never appears.
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("partsport_demo_guide_v1", "1");
  } catch {}
});

const page = await ctx.newPage();

page.on("console", (msg) => {
  if (msg.type() === "error") {
    consoleErrors.push({ url: page.url(), text: msg.text() });
  }
});
page.on("pageerror", (err) => {
  pageErrors.push({ url: page.url(), text: err.message });
});
page.on("response", (res) => {
  if (res.status() >= 400) {
    failedRequests.push({
      url: res.url(),
      status: res.status(),
      method: res.request().method(),
    });
  }
});

let orderId = null;
let firstProductHref = null;
let secondProductHref = null;
let firstSku = null;
let secondSku = null;
let highPriceProductHref = null;

async function navIdle(url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await dismissDemoGuide(page);
}

// ============ STEP 1: LOGIN ============
await safe("01 — login", async () => {
  await navIdle(BASE + "/login");
  await shot(page, "01-login-form.png");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASS);
  await page.click("button:has-text('Sign in')");
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await dismissDemoGuide(page);
  await shot(page, "02-after-login.png");
  return `Landed at ${page.url()}`;
});

// ============ STEP 2: HOME / ACCOUNT ============
await safe("02 — account page", async () => {
  await navIdle(BASE + "/account");
  await shot(page, "03-account.png");
  const txt = (await page.textContent("body")) || "";
  const hasName = txt.includes("Jordan");
  return `Account len=${txt.length} hasNameField=${hasName}`;
});

await safe("03 — homepage", async () => {
  await navIdle(BASE + "/");
  await shot(page, "04-home.png");
  return `Home loaded`;
});

// ============ STEP 3: CATALOG ============
await safe("04 — catalog browse", async () => {
  await navIdle(BASE + "/catalog");
  await shot(page, "05-catalog.png");
  const productCount = await page.locator("a[href^='/product/']").count();
  return `${productCount} product links visible`;
});

await safe("05 — catalog search 'circuit breaker'", async () => {
  await navIdle(BASE + "/catalog?q=circuit+breaker");
  await shot(page, "06-catalog-search.png");
  const productCount = await page.locator("a[href^='/product/']").count();
  return `${productCount} search results`;
});

await safe("06 — collect 2 non-quote-only product hrefs (price-asc)", async () => {
  await navIdle(BASE + "/catalog?sort=price-asc");
  const links = await page
    .locator("a[href^='/product/']")
    .evaluateAll((els) =>
      els.map((e) => e.getAttribute("href")).filter(Boolean)
    );
  const unique = [...new Set(links)];
  firstProductHref = unique[0];
  secondProductHref = unique[1];
  return `1st=${firstProductHref}  2nd=${secondProductHref}`;
});

// ============ STEP 4: PRODUCT PAGE + ADD TO CART ============
await safe("07 — view product 1 + add to cart", async () => {
  await navIdle(BASE + firstProductHref);
  await shot(page, "07-product-1.png");
  firstSku = firstProductHref.split("/").pop();
  const addBtn = page.locator("button:has-text('Add to cart')").first();
  if ((await addBtn.count()) === 0) throw new Error("no add-to-cart button");
  await addBtn.click({ timeout: 8000 });
  await page.waitForTimeout(800);
  await shot(page, "08-after-add-1.png");
  // Check cart count via localStorage
  const cartRaw = await page.evaluate(() =>
    localStorage.getItem("partsport_cart_v1")
  );
  return `Added SKU ${firstSku}; cart=${cartRaw}`;
});

await safe("08 — view product 2 + add to cart", async () => {
  if (!secondProductHref) throw new Error("no second product");
  await navIdle(BASE + secondProductHref);
  await shot(page, "09-product-2.png");
  secondSku = secondProductHref.split("/").pop();
  const addBtn = page.locator("button:has-text('Add to cart')").first();
  if ((await addBtn.count()) === 0) throw new Error("no add-to-cart button");
  await addBtn.click({ timeout: 8000 });
  await page.waitForTimeout(800);
  const cartRaw = await page.evaluate(() =>
    localStorage.getItem("partsport_cart_v1")
  );
  return `Added SKU ${secondSku}; cart=${cartRaw}`;
});

// ============ STEP 5: CART PAGE ============
await safe("09 — cart page", async () => {
  await navIdle(BASE + "/cart");
  await page.waitForTimeout(1500);
  await shot(page, "10-cart.png");
  const txt = (await page.textContent("body")) || "";
  const lineCount = await page.locator(".cart-line").count();
  return `Cart page loaded. cart-line count=${lineCount}`;
});

await safe("10 — cart change qty (increase)", async () => {
  const incBtns = page.locator(".qty-stepper button[aria-label='Increase']");
  const n = await incBtns.count();
  if (n === 0) return "no qty stepper buttons";
  await incBtns.first().click();
  await page.waitForTimeout(500);
  await incBtns.first().click();
  await page.waitForTimeout(500);
  await shot(page, "11-cart-qty-changed.png");
  return `Increased first line qty +2`;
});

await safe("10b — cart remove second line", async () => {
  // We need 2 items going forward, so DON'T actually remove. Just verify Remove exists.
  const removeBtns = page.locator(".ci-remove");
  const n = await removeBtns.count();
  return `Remove buttons available=${n} (not clicked, need 2 items downstream)`;
});

// ============ STEP 6: PROCEED TO CHECKOUT ============
await safe("11 — go to checkout", async () => {
  await navIdle(BASE + "/checkout");
  await page.waitForTimeout(1500);
  await shot(page, "12-checkout-form.png");
  const hasForm = (await page.locator("#cname").count()) > 0;
  return `Checkout form present: ${hasForm}`;
});

// ============ STEP 7: FILL CHECKOUT FORM ============
await safe("12 — fill checkout form", async () => {
  const hasCname = (await page.locator("#cname").count()) > 0;
  if (!hasCname) throw new Error("checkout form not found — cart may be empty");
  await page.fill("#cname", "Jordan Buyer");
  await page.fill("#cemail", EMAIL);
  await page.fill(
    "#cship",
    "Acme Power Co\n123 Industrial Way\nDallas, TX 75201\nUSA"
  );
  await shot(page, "13-checkout-filled.png");
  // Capture orderId from /api/orders POST response
  const orderRespPromise = page
    .waitForResponse(
      (resp) =>
        resp.url().endsWith("/api/orders") && resp.request().method() === "POST",
      { timeout: 15000 }
    )
    .catch(() => null);
  await page.click("button:has-text('Continue to payment')");
  const orderResp = await orderRespPromise;
  if (orderResp && orderResp.ok()) {
    const body = await orderResp.json().catch(() => null);
    if (body?.orderId) {
      orderId = body.orderId;
    }
  }
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await shot(page, "14-checkout-pay.png");
  return `submitted form, captured orderId=${orderId}, now at ${page.url()}`;
});

// ============ STEP 7b: PAY ============
await safe("13 — pay (demo / hosted / paypal)", async () => {
  const placeBtn = page.locator("button:has-text('Place order')").first();
  const hostedBtn = page
    .locator("button:has-text('Pay by bank transfer')")
    .first();
  if ((await placeBtn.count()) > 0) {
    await placeBtn.click();
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await shot(page, "15-after-pay.png");
    const url = page.url();
    const m = url.match(/\/orders\/([^/?]+)/);
    if (m) orderId = m[1];
    return `Demo payment. URL=${url} orderId=${orderId}`;
  } else if ((await hostedBtn.count()) > 0) {
    return `Hosted payment (Stripe-style) button shown — cannot auto-complete external checkout`;
  } else {
    const iframes = await page.locator("iframe").count();
    return `No demo/hosted button. ${iframes} iframes (PayPal?)`;
  }
});

// ============ STEP 8: ORDER DETAIL ============
await safe("14 — order detail page", async () => {
  if (!orderId) return "skipped — no orderId";
  await navIdle(BASE + `/orders/${orderId}`);
  await shot(page, "16-order-detail.png");
  const txt = (await page.textContent("body")) || "";
  const hasTotal = /\$\d/.test(txt);
  const hasStatus = /paid|processing|shipped|delivered|pending/i.test(txt);
  return `Order page hasTotal=${hasTotal} hasStatus=${hasStatus}`;
});

// ============ STEP 9: INVOICE ============
await safe("15 — invoice page", async () => {
  if (!orderId) return "skipped — no orderId";
  await navIdle(BASE + `/orders/${orderId}/invoice`);
  await shot(page, "17-invoice.png");
  const txt = (await page.textContent("body")) || "";
  const hasInvoice = /invoice/i.test(txt);
  return `Invoice page len=${txt.length} hasInvoice=${hasInvoice}`;
});

// ============ STEP 10: RFQ ============
await safe("16 — RFQ: high-ticket product", async () => {
  await navIdle(BASE + "/catalog?sort=price-desc");
  await shot(page, "18-catalog-sorted.png");
  const first = await page
    .locator("a[href^='/product/']")
    .first()
    .getAttribute("href");
  highPriceProductHref = first;
  if (!first) throw new Error("no product");
  await navIdle(BASE + first);
  await shot(page, "19-rfq-product.png");
  const quoteBtn = page
    .locator(
      "button:has-text('Request a quote'), button:has-text('Request quote'), a:has-text('Request a quote'), a:has-text('Request quote')"
    )
    .first();
  const cnt = await quoteBtn.count();
  if (cnt === 0) return `No quote CTA on ${first}`;
  await quoteBtn.click({ timeout: 6000 });
  await page.waitForTimeout(1500);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await dismissDemoGuide(page);
  await shot(page, "20-rfq-form.png");
  // try fill if form (could be a form on same page or new page)
  const ta = page.locator("textarea").first();
  if ((await ta.count()) > 0) {
    await ta.fill(
      "Need 5 units for a substation project. Required by Q3. Please advise pricing and lead time."
    );
    // try filling name/email
    const nameIn = page.locator("input[name*='name' i], #name").first();
    if ((await nameIn.count()) > 0) await nameIn.fill("Jordan Buyer").catch(() => {});
    const emailIn = page.locator("input[type='email']").first();
    if ((await emailIn.count()) > 0) await emailIn.fill(EMAIL).catch(() => {});
    const submit = page
      .locator(
        "button:has-text('Submit'), button:has-text('Send request'), button:has-text('Request quote'), button[type='submit']"
      )
      .first();
    if ((await submit.count()) > 0) {
      await submit.click({ timeout: 6000 });
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await shot(page, "21-rfq-submitted.png");
      return `RFQ submitted from ${first}`;
    }
    return `Found textarea but no submit button at ${page.url()}`;
  }
  return `Clicked quote CTA but no textarea appeared at ${page.url()}`;
});

// ============ STEP 11: MESSAGE THREAD ============
await safe("17 — message thread on order page", async () => {
  if (!orderId) return "skipped — no order";
  await navIdle(BASE + `/orders/${orderId}`);
  // Look for message UI
  const msgArea = page.locator("textarea").first();
  if ((await msgArea.count()) === 0) return `no textarea on order page`;
  await msgArea.fill("Hi, please confirm shipping date and tracking when available.");
  const sendBtn = page
    .locator(
      "button:has-text('Send'), button:has-text('Post message'), button:has-text('Send message')"
    )
    .first();
  if ((await sendBtn.count()) === 0) return `textarea exists but no Send button`;
  await sendBtn.click({ timeout: 5000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await shot(page, "22-message-sent.png");
  return `Message sent`;
});

// ============ STEP 12: ACCOUNT — ADDRESSES ============
await safe("18 — account addresses + add new", async () => {
  await navIdle(BASE + "/account");
  await shot(page, "23-account.png");
  const txt = (await page.textContent("body")) || "";
  const hasAddressBook = /address(es)?/i.test(txt);
  // find add address inputs
  const labelHint = page.locator("input").filter({ hasText: "" });
  const totalInputs = await page.locator("input:visible").count();
  // try clicking any add-address-style button
  const addBtn = page
    .locator(
      "button:has-text('Add an address'), button:has-text('Add address'), button:has-text('Add new'), a:has-text('Add address')"
    )
    .first();
  const addBtnCnt = await addBtn.count();
  let saveResult = "no add-address button";
  if (addBtnCnt > 0) {
    await addBtn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, "24a-address-form-open.png");
  }
  // Look for address-form input names/ids in AddressBook component
  // Try common field names
  const tryFill = async (sel, val) => {
    const el = page.locator(sel).first();
    if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) {
      await el.fill(val).catch(() => {});
      return true;
    }
    return false;
  };
  await tryFill("#ad-label", "Office");
  await tryFill("#ad-recipient", "Jordan Buyer");
  await tryFill("#ad-company", "Acme Power Co");
  await tryFill("#ad-line1", "200 Receiving Dock");
  await tryFill("#ad-line2", "Bay 4");
  await tryFill("#ad-city", "Austin");
  await tryFill("#ad-region", "TX");
  await tryFill("#ad-postal", "78701");
  await tryFill("#ad-phone", "5125551234");
  const saveBtn = page
    .locator(
      "button:has-text('Save address'), button[type='submit']"
    )
    .first();
  if ((await saveBtn.count()) > 0) {
    await saveBtn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1500);
    saveResult = "clicked Save";
  }
  await shot(page, "24-address-form.png");
  return `hasAddressBook=${hasAddressBook} totalInputs=${totalInputs} addBtns=${addBtnCnt} ${saveResult}`;
});

// ============ STEP 13: ORDER HISTORY ============
await safe("19 — order history visible on /account", async () => {
  await navIdle(BASE + "/account");
  const txt = (await page.textContent("body")) || "";
  const orderRefInPage =
    orderId &&
    (txt.includes(orderId.slice(0, 8)) ||
      txt.includes(orderId.slice(-6)) ||
      /order/i.test(txt));
  const orderLinks = await page.locator("a[href^='/orders/']").count();
  return `orderLinks=${orderLinks} orderRefInPage=${!!orderRefInPage}`;
});

// ============ STEP 14: REVIEW FLOW ============
await safe("20 — review flow on product", async () => {
  if (!firstProductHref) return "skipped";
  await navIdle(BASE + firstProductHref);
  await shot(page, "25-product-review-area.png");
  const reviewBtn = page
    .locator(
      "button:has-text('Write a review'), button:has-text('Leave a review'), a:has-text('Write a review'), button:has-text('Post review')"
    )
    .first();
  const cnt = await reviewBtn.count();
  const txt = (await page.textContent("body")) || "";
  const mentionsReview = /review/i.test(txt);
  return `review CTA count=${cnt} mentionsReview=${mentionsReview}`;
});

// ============ STEP 15: CANCEL/RETURN ============
await safe("21 — cancel / return on order", async () => {
  if (!orderId) return "skipped";
  await navIdle(BASE + `/orders/${orderId}`);
  const cancelBtn = page
    .locator(
      "button:has-text('Cancel order'), button:has-text('Cancel'), button:has-text('Return'), button:has-text('Start return'), a:has-text('Return')"
    )
    .first();
  const cnt = await cancelBtn.count();
  await shot(page, "26-order-cancel.png");
  return `cancel/return CTA count=${cnt}`;
});

// ============ STEP 16: REORDER ============
await safe("22 — reorder", async () => {
  if (!orderId) return "skipped";
  await navIdle(BASE + `/orders/${orderId}`);
  const reorderBtn = page
    .locator("button:has-text('Reorder'), a:has-text('Reorder')")
    .first();
  const cnt = await reorderBtn.count();
  if (cnt > 0) {
    await reorderBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await shot(page, "27-reorder.png");
  }
  return `reorder CTA count=${cnt}`;
});

// ============ FINAL ============
await safe("23 — final account view", async () => {
  await navIdle(BASE + "/account");
  await shot(page, "28-final-account.png");
  return "done";
});

const summary = {
  orderId,
  firstProductHref,
  secondProductHref,
  highPriceProductHref,
  firstSku,
  secondSku,
  steps,
  consoleErrors,
  pageErrors,
  failedRequests,
};

writeFileSync(
  "C:/Users/radfe/rok-preview/test-runs/buyer-result.json",
  JSON.stringify(summary, null, 2)
);

await browser.close();
console.log("\n=== DONE ===");
console.log("orderId:", orderId);
console.log("steps:", steps.length);
console.log(
  "PASS:",
  steps.filter((s) => s.status === "PASS").length,
  "FAIL:",
  steps.filter((s) => s.status === "FAIL").length
);
console.log("consoleErrors:", consoleErrors.length);
console.log("pageErrors:", pageErrors.length);
console.log("failedRequests:", failedRequests.length);
