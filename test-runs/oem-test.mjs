import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE = "https://rok-preview-git-claude-industrial-marketplace-rowau-agentrad.vercel.app";
const SHOTS = "C:\\Users\\radfe\\rok-preview\\test-runs\\screenshots\\oem";
const EMAIL = "oem@partsport.example";
const PASSWORD = "demo1234";

if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const steps = [];

function log(step, status, note = "") {
  const line = `[${status}] ${step}${note ? ` — ${note}` : ""}`;
  console.log(line);
  steps.push({ step, status, note });
}

async function shot(page, name) {
  try {
    await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
  } catch (e) {
    console.log("screenshot failed", name, e.message);
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true, slowMo: 100 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`[console] ${msg.text()}`);
  });
  page.on("pageerror", (err) => pageErrors.push(`[pageerror] ${err.message}`));
  page.on("requestfailed", (req) => {
    failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });
  page.on("response", (res) => {
    if (res.status() >= 500) failedRequests.push(`HTTP ${res.status()} ${res.url()}`);
  });

  // Step 1: login
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    // dismiss demo guide overlay if present - click the close X
    if (await page.locator(".dg-overlay").isVisible().catch(() => false)) {
      await page.locator(".dg-close").click({ force: true }).catch(async () => {
        await page.evaluate(() => {
          const el = document.querySelector(".dg-overlay");
          if (el) el.remove();
        });
      });
      await page.waitForTimeout(400);
    }
    await shot(page, "01-login.png");
    await page.fill("#email", EMAIL);
    await page.fill("#password", PASSWORD);
    await shot(page, "02-login-filled.png");
    // Submit the form (no type=submit attribute; default-submit button inside .auth-card form)
    await page.locator(".auth-card form button.btn-primary").click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    await shot(page, "03-after-login.png");
    log("Login", "PASS", `landed at ${page.url()}`);
  } catch (e) {
    log("Login", "FAIL", e.message);
  }

  // Step 2: /oem dashboard
  try {
    await page.goto(`${BASE}/oem`, { waitUntil: "networkidle" });
    await shot(page, "04-oem-dashboard.png");
    const title = await page.textContent("h1").catch(() => "");
    const bodyText = await page.locator("main").innerText().catch(() => "");
    log("/oem dashboard", "PASS", `h1="${title?.trim()}"`);
    fs.writeFileSync(path.join(SHOTS, "..", "..", "oem-dashboard-text.txt"), bodyText);
  } catch (e) {
    log("/oem dashboard", "FAIL", e.message);
  }

  // Step 3: capture sections / KPI values
  let kpiText = "";
  try {
    const kpis = await page.locator(".kpi").all();
    for (const k of kpis) {
      const t = await k.innerText();
      kpiText += t.replace(/\n/g, " | ") + "\n";
    }
    log("KPIs captured", "INFO", kpiText.replace(/\n/g, " // "));
  } catch (e) {
    log("KPIs", "FAIL", e.message);
  }

  // Step 4: demand signals
  let searchTerms = [];
  try {
    const rows = await page.locator("table tbody tr").all();
    for (const r of rows.slice(0, 10)) {
      searchTerms.push(await r.innerText());
    }
    log("Demand signals table", "INFO", `${rows.length} rows`);
  } catch (e) {
    log("Demand signals", "FAIL", e.message);
  }

  // Step 5: authorized distributors visible
  try {
    const distSection = await page.locator("text=Authorized distributors").first().isVisible();
    log("Authorized distributors section visible", distSection ? "PASS" : "FAIL");
  } catch (e) {
    log("Authorized distributors", "FAIL", e.message);
  }

  // Step 6: check for storefront edit / link
  let storefrontLinks = [];
  try {
    const links = await page.locator("a").all();
    for (const l of links) {
      const href = await l.getAttribute("href").catch(() => null);
      const txt = (await l.innerText().catch(() => "")).slice(0, 50);
      if (href && /siemens|storefront|manufacturer/i.test(href + " " + txt)) {
        storefrontLinks.push(`${txt} -> ${href}`);
      }
    }
    log("Storefront-related links on /oem", "INFO", storefrontLinks.join(" ; ") || "NONE");
  } catch (e) {
    log("Storefront links", "FAIL", e.message);
  }

  // Step 7: navigation header — look for edit option
  try {
    const headerHtml = await page.locator("header, nav").first().innerText().catch(() => "");
    log("Header nav", "INFO", headerHtml.replace(/\n/g, " | "));
  } catch (e) {}

  // Step 8: /manufacturers public page
  try {
    await page.goto(`${BASE}/manufacturers`, { waitUntil: "networkidle" });
    await shot(page, "05-manufacturers-public.png");
    const siemensCard = await page.locator("text=Siemens").first().isVisible().catch(() => false);
    const siemensLinkHref = await page.locator("a:has-text('Siemens')").first().getAttribute("href").catch(() => null);
    log("/manufacturers shows Siemens", siemensCard ? "PASS" : "FAIL", `link=${siemensLinkHref}`);
  } catch (e) {
    log("/manufacturers", "FAIL", e.message);
  }

  // Step 9: Visit Siemens storefront (logged in)
  let storefrontUrl = null;
  try {
    const siemensLink = await page.locator("a:has-text('Siemens')").first().getAttribute("href").catch(() => null);
    if (siemensLink) {
      storefrontUrl = siemensLink.startsWith("http") ? siemensLink : BASE + siemensLink;
      await page.goto(storefrontUrl, { waitUntil: "networkidle" });
      await shot(page, "06-storefront-loggedin.png");
      const h1 = await page.textContent("h1").catch(() => "");
      log("Siemens storefront (logged in)", "PASS", `url=${storefrontUrl} h1="${h1?.trim()}"`);
    } else {
      log("Siemens storefront link", "FAIL", "no link found on /manufacturers");
    }
  } catch (e) {
    log("Siemens storefront", "FAIL", e.message);
  }

  // Step 10: Visit storefront logged-out (new context)
  if (storefrontUrl) {
    try {
      const anonCtx = await browser.newContext();
      const anonPage = await anonCtx.newPage();
      await anonPage.goto(storefrontUrl, { waitUntil: "networkidle" });
      await anonPage.screenshot({ path: path.join(SHOTS, "07-storefront-anon.png"), fullPage: true });
      const txt = await anonPage.locator("main").innerText().catch(() => "");
      log("Siemens storefront (anon)", "PASS", `len=${txt.length} starts="${txt.slice(0, 80).replace(/\n/g, " ")}"`);
      await anonCtx.close();
    } catch (e) {
      log("Siemens storefront anon", "FAIL", e.message);
    }
  }

  // Step 11: No-sales-access checks
  const sealed = ["/supplier", "/admin", "/cart", "/checkout", "/ops"];
  for (const route of sealed) {
    try {
      const resp = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      const finalUrl = page.url();
      const status = resp?.status();
      const redirected = !finalUrl.endsWith(route);
      const bodySnippet = (await page.locator("body").innerText().catch(() => "")).slice(0, 200).replace(/\n/g, " ");
      await shot(page, `08-route-${route.replace(/\//g, "_")}.png`);
      log(`Access ${route}`, redirected || status >= 400 ? "SEALED" : "ALLOWED-BUG", `status=${status} -> ${finalUrl} | "${bodySnippet}"`);
    } catch (e) {
      log(`Access ${route}`, "ERROR", e.message);
    }
  }

  // Step 12: /account
  try {
    await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
    await shot(page, "09-account.png");
    const acct = await page.locator("main").innerText().catch(() => "");
    log("/account", "INFO", `len=${acct.length}; first=${acct.slice(0, 200).replace(/\n/g, " | ")}`);
  } catch (e) {
    log("/account", "FAIL", e.message);
  }

  // Step 13: /settings
  try {
    const resp = await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
    await shot(page, "10-settings.png");
    log("/settings", "INFO", `status=${resp?.status()} url=${page.url()}`);
  } catch (e) {
    log("/settings", "FAIL", e.message);
  }

  // Step 14: Try editing storefront — look for any edit UI on /oem
  try {
    await page.goto(`${BASE}/oem`, { waitUntil: "networkidle" });
    const editButtons = await page.locator("button:has-text('Edit'), a:has-text('Edit'), button:has-text('Customize'), a:has-text('Customize')").all();
    log("Edit storefront affordance on /oem", editButtons.length > 0 ? "FOUND" : "MISSING", `count=${editButtons.length}`);
  } catch (e) {
    log("Edit storefront affordance", "FAIL", e.message);
  }

  // Step 15: header on /oem (to see what nav items exist for OEM)
  try {
    const nav = await page.locator("header").first().innerText().catch(() => "");
    await shot(page, "11-oem-header.png");
    log("OEM header nav items", "INFO", nav.replace(/\n/g, " | "));
  } catch (e) {}

  // Step 16: try product detail — clicking a row product
  try {
    await page.goto(`${BASE}/catalog`, { waitUntil: "networkidle" });
    await shot(page, "12-catalog-as-oem.png");
    log("OEM can view /catalog", "INFO", `url=${page.url()}`);
  } catch (e) {
    log("/catalog", "FAIL", e.message);
  }

  // Save final dump
  fs.writeFileSync(
    path.join(SHOTS, "..", "..", "oem-test-log.json"),
    JSON.stringify({ steps, consoleErrors, pageErrors, failedRequests, kpiText, searchTerms, storefrontLinks }, null, 2)
  );

  await browser.close();
  console.log("\n=== DONE ===");
  console.log("console errors:", consoleErrors.length);
  console.log("page errors:", pageErrors.length);
  console.log("failed requests:", failedRequests.length);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
