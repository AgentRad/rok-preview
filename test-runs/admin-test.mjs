import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE = "https://rok-preview-git-claude-industrial-marketplace-rowau-agentrad.vercel.app";
const SHOT_DIR = "C:\\Users\\radfe\\rok-preview\\test-runs\\screenshots\\admin";
const REPORT_PATH = "C:\\Users\\radfe\\rok-preview\\test-runs\\reports\\admin.md";

fs.mkdirSync(SHOT_DIR, { recursive: true });

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const steps = [];

async function step(name, fn) {
  const entry = { name, status: "PASS", notes: [], error: null };
  steps.push(entry);
  console.log(`\n=== ${name} ===`);
  try {
    await fn(entry);
    console.log(`OK: ${name}`);
  } catch (e) {
    entry.status = "FAIL";
    entry.error = String(e && e.message ? e.message : e);
    console.error(`FAIL ${name}: ${entry.error}`);
  }
  return entry;
}

function shotPath(name) {
  return path.join(SHOT_DIR, name);
}

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: false, slowMo: 300 });
  } catch (e) {
    console.warn("chrome channel failed, falling back to headless shell:", e.message);
    browser = await chromium.launch({ headless: true, slowMo: 100 });
  }
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  // Pre-set demo-guide dismissal so its modal does not intercept clicks
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("partsport_demo_guide_v1", "1");
    } catch {}
  });
  const page = await ctx.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push({ url: page.url(), text: msg.text() });
  });
  page.on("pageerror", (err) => pageErrors.push({ url: page.url(), text: String(err.message) }));
  page.on("requestfailed", (req) => {
    failedRequests.push({ url: req.url(), failure: req.failure()?.errorText, method: req.method() });
  });
  page.on("response", (resp) => {
    if (resp.status() >= 500) {
      failedRequests.push({ url: resp.url(), failure: `HTTP ${resp.status()}`, method: resp.request().method() });
    }
  });

  await step("01_login", async (s) => {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    // Defensive: dismiss demo guide if it still shows
    const dgClose = page.locator('.dg-close, button[aria-label="Close"]');
    if (await dgClose.count()) await dgClose.first().click().catch(() => {});
    await page.screenshot({ path: shotPath("01-login.png"), fullPage: true });
    await page.fill('input[type="email"], input[name="email"]', "admin@partsport.example");
    await page.fill('input[type="password"], input[name="password"]', "demo1234");
    // Submit the login form (not the search button) — scope to the form
    const loginForm = page.locator("form").filter({ has: page.locator('input[type="password"]') });
    await loginForm.locator("button.btn-primary").first().click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shotPath("01b-after-login.png"), fullPage: true });
    s.notes.push(`URL after login: ${page.url()}`);
  });

  await step("02_admin_console", async (s) => {
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shotPath("02-admin.png"), fullPage: true });
    const title = await page.locator("h1").first().textContent().catch(() => "");
    s.notes.push(`H1: ${title}`);
    const kpis = await page.locator(".kpi").allTextContents().catch(() => []);
    s.notes.push(`KPIs: ${kpis.map((k) => k.replace(/\s+/g, " ").trim()).join(" | ")}`);
    const sections = await page.locator(".card h2").allTextContents().catch(() => []);
    s.notes.push(`Sections: ${sections.join(", ")}`);
  });

  await step("03_supplier_application_approve", async (s) => {
    const appCard = page.locator(".card", { has: page.locator('h2:has-text("Supplier applications")') });
    if ((await appCard.count()) === 0) {
      s.notes.push("Supplier applications card not on page");
      return;
    }
    const empty = await appCard.locator(".empty-block").count();
    if (empty > 0) {
      s.notes.push("No pending applications in seed data");
      return;
    }
    const firstRow = appCard.locator("table tbody tr").first();
    const rowText = await firstRow.textContent();
    s.notes.push(`First applicant row: ${rowText?.replace(/\s+/g, " ").trim().slice(0, 200)}`);
    await firstRow.locator('button:has-text("Approve")').click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: shotPath("03-app-approved.png"), fullPage: true });
    const result = await firstRow.textContent();
    s.notes.push(`Result text: ${result?.replace(/\s+/g, " ").trim().slice(0, 300)}`);
  });

  await step("04_supplier_edit", async (s) => {
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const supplierCard = page.locator(".card", { has: page.locator('h2:has-text("Suppliers")') });
    const supplierRows = supplierCard.locator("table tbody tr");
    const count = await supplierRows.count();
    s.notes.push(`Supplier row count: ${count}`);
    if (count === 0) return;
    const firstRow = supplierRows.first();
    await firstRow.locator('button:has-text("Edit")').click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: shotPath("04-supplier-edit-open.png"), fullPage: true });
    const descTa = page.locator("textarea").first();
    const oldDesc = await descTa.inputValue();
    s.notes.push(`Original description length: ${oldDesc.length}`);
    await descTa.fill(oldDesc + " [QA-touch]");
    await page.locator('button:has-text("Save")').first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shotPath("04b-supplier-saved.png"), fullPage: true });
    // restore
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const supplierCard2 = page.locator(".card", { has: page.locator('h2:has-text("Suppliers")') });
    await supplierCard2.locator("table tbody tr").first().locator('button:has-text("Edit")').click();
    await page.waitForTimeout(500);
    await page.locator("textarea").first().fill(oldDesc);
    await page.locator('button:has-text("Save")').first().click();
    await page.waitForTimeout(1500);
    s.notes.push("Edit + restore round-trip OK");
  });

  await step("05_invoices_csv", async (s) => {
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const link = page.locator('a:has-text("Export for QuickBooks")');
    if (!(await link.count())) {
      s.notes.push("No invoices CSV link visible");
      return;
    }
    const downloadPromise = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
    await link.first().click();
    const dl = await downloadPromise;
    if (!dl) {
      // Maybe rendered inline as JSON / text
      const resp = await page.context().request.get(`${BASE}/api/admin/invoices.csv`);
      s.notes.push(`Direct fetch status: ${resp.status()}, content-type: ${resp.headers()["content-type"]}`);
      const txt = await resp.text();
      s.notes.push(`Body first 200 chars: ${txt.slice(0, 200)}`);
      fs.writeFileSync(path.join(SHOT_DIR, "invoices.csv"), txt);
    } else {
      const saveTo = path.join(SHOT_DIR, "invoices.csv");
      await dl.saveAs(saveTo);
      const sz = fs.statSync(saveTo).size;
      s.notes.push(`Downloaded invoices.csv (${sz} bytes), suggestedFilename=${dl.suggestedFilename()}`);
    }
  });

  await step("06_orders_csv", async (s) => {
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const link = page.locator('a:has-text("Export all orders")');
    if (!(await link.count())) {
      s.notes.push("No orders CSV link visible");
      return;
    }
    const downloadPromise = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
    await link.first().click();
    const dl = await downloadPromise;
    if (!dl) {
      const resp = await page.context().request.get(`${BASE}/api/admin/orders.csv`);
      s.notes.push(`Direct fetch status: ${resp.status()}, content-type: ${resp.headers()["content-type"]}`);
      const txt = await resp.text();
      s.notes.push(`Body first 200 chars: ${txt.slice(0, 200)}`);
      fs.writeFileSync(path.join(SHOT_DIR, "orders.csv"), txt);
    } else {
      const saveTo = path.join(SHOT_DIR, "orders.csv");
      await dl.saveAs(saveTo);
      const sz = fs.statSync(saveTo).size;
      s.notes.push(`Downloaded orders.csv (${sz} bytes), suggestedFilename=${dl.suggestedFilename()}`);
    }
  });

  await step("07_tax_exempt", async (s) => {
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const card = page.locator(".card", { has: page.locator('h2:has-text("Tax-exempt certificates")') });
    if ((await card.count()) === 0) {
      s.notes.push("Tax-exempt card not on page");
      return;
    }
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shotPath("07-tax-exempt.png"), fullPage: true });
    const isEmpty = await card.locator(".empty-block").count();
    if (isEmpty > 0) {
      s.notes.push("No tax-exempt certificates section data");
      return;
    }
    const rows = card.locator("table tbody tr");
    const n = await rows.count();
    s.notes.push(`Tax-exempt rows: ${n}`);
    if (n === 0) return;
    // Find a row with PENDING badge to approve
    let approved = false;
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i);
      const badge = await row.locator(".badge").textContent();
      if (badge && badge.trim() === "PENDING") {
        // try the cert link too
        const certHref = await row.locator('a:has-text("View cert")').getAttribute("href").catch(() => null);
        s.notes.push(`Cert URL: ${certHref}`);
        await row.locator('button:has-text("Approve")').click();
        await page.waitForTimeout(1500);
        approved = true;
        break;
      }
    }
    s.notes.push(approved ? "Approved one cert" : "No PENDING certs to approve");
    await page.screenshot({ path: shotPath("07b-tax-after.png"), fullPage: true });
  });

  await step("08_acting_as", async (s) => {
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const supplierCard = page.locator(".card", { has: page.locator('h2:has-text("Suppliers")') });
    const manageBtn = supplierCard.locator("table tbody tr").first().locator('button:has-text("Manage as")');
    if (!(await manageBtn.count())) {
      s.notes.push("No 'Manage as' button found");
      return;
    }
    await manageBtn.click();
    await page.waitForTimeout(2000);
    s.notes.push(`URL after Manage as: ${page.url()}`);
    await page.screenshot({ path: shotPath("08-acting-as.png"), fullPage: true });
    const banner = await page.locator("body").textContent();
    const hasActingBanner = /acting\s*as|stop\s*acting|on behalf/i.test(banner || "");
    s.notes.push(`Acting-as banner detected: ${hasActingBanner}`);

    // Try clearing via DELETE
    const stopBtn = page.locator('button:has-text("Stop"), a:has-text("Stop"), button:has-text("Exit")');
    if ((await stopBtn.count()) > 0) {
      await stopBtn.first().click().catch(() => {});
      await page.waitForTimeout(1500);
      s.notes.push("Clicked Stop/Exit acting-as control");
    } else {
      const resp = await page.context().request.delete(`${BASE}/api/admin/acting-as`);
      s.notes.push(`DELETE acting-as status: ${resp.status()}`);
    }
  });

  await step("09_ops_board", async (s) => {
    await page.goto(`${BASE}/ops`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shotPath("09-ops.png"), fullPage: true });
    const h1 = await page.locator("h1").first().textContent().catch(() => "");
    s.notes.push(`Ops H1: ${h1}`);
    const stageHeads = await page.locator(".card .card-head h2").allTextContents();
    s.notes.push(`Ops sections: ${stageHeads.join(", ")}`);

    // advance one order: prefer New -> Processing
    const newCard = page.locator(".card", { has: page.locator('h2:has-text("New ")') }).first();
    const newCount = await newCard.locator('button:has-text("Start processing")').count();
    s.notes.push(`'Start processing' buttons: ${newCount}`);
    if (newCount > 0) {
      await newCard.locator('button:has-text("Start processing")').first().click();
      await page.waitForTimeout(2000);
      s.notes.push("Advanced one order New -> Processing");
      await page.screenshot({ path: shotPath("09b-ops-advance.png"), fullPage: true });
    }
  });

  await step("10_payouts", async (s) => {
    await page.goto(`${BASE}/ops`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const payoutCard = page.locator(".card", { has: page.locator('h2:has-text("Payouts owed")') });
    if ((await payoutCard.count()) === 0) {
      s.notes.push("Payouts card not on page");
      return;
    }
    await payoutCard.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shotPath("10-payouts.png"), fullPage: true });
    const empty = await payoutCard.locator(".empty-block").count();
    if (empty > 0) {
      s.notes.push("No payouts due (empty state)");
      return;
    }
    const rows = payoutCard.locator("table tbody tr");
    const n = await rows.count();
    s.notes.push(`Payouts due rows: ${n}`);
    if (n === 0) return;
    page.once("dialog", (d) => d.accept());
    await rows.first().locator('button:has-text("Mark paid")').click();
    await page.waitForTimeout(2000);
    s.notes.push("Marked one payout paid");
  });

  await step("11_returns_rma", async (s) => {
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const card = page.locator(".card", { has: page.locator('h2:has-text("Return requests")') });
    const exists = await card.count();
    if (!exists) {
      s.notes.push("Return requests card not present (no returns in seed)");
      return;
    }
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shotPath("11-returns.png"), fullPage: true });
    const rows = card.locator("table tbody tr");
    const n = await rows.count();
    s.notes.push(`Return rows: ${n}`);
  });

  await step("12_settings", async (s) => {
    await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: shotPath("12-settings.png"), fullPage: true });
    const h1 = await page.locator("h1").first().textContent().catch(() => "");
    s.notes.push(`URL: ${page.url()} / H1: ${h1}`);
    const status = await page.evaluate(() => document.title);
    s.notes.push(`Title: ${status}`);
  });

  await step("13_misc_links", async (s) => {
    // Re-check admin and capture any obvious empty widgets vs data
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const empties = await page.locator(".empty-block h3").allTextContents();
    s.notes.push(`Empty blocks: ${empties.join(" | ")}`);
    // Check broken images
    const imgIssues = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll("img"));
      return imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src);
    });
    s.notes.push(`Broken images count: ${imgIssues.length}`);
    if (imgIssues.length) s.notes.push(`Sample broken img: ${imgIssues.slice(0, 3).join(", ")}`);
  });

  await browser.close();

  // -------- write report --------
  const summaryRow = (label, stepName) => {
    const st = steps.find((s) => s.name === stepName);
    return `- ${label}: ${st ? st.status : "N/A"}`;
  };

  const md = [];
  md.push("# Admin POV — Test Report\n");
  md.push("## Summary");
  md.push(summaryRow("Login", "01_login"));
  md.push(`- Admin console accessible: ${steps.find((s) => s.name === "02_admin_console")?.status === "PASS" ? "yes" : "no"}`);
  md.push(`- Ops board accessible: ${steps.find((s) => s.name === "09_ops_board")?.status === "PASS" ? "yes" : "no"}`);
  md.push(summaryRow("Supplier approval", "03_supplier_application_approve"));
  const csvOk =
    steps.find((s) => s.name === "05_invoices_csv")?.status === "PASS" &&
    steps.find((s) => s.name === "06_orders_csv")?.status === "PASS";
  md.push(`- CSV exports: ${csvOk ? "PASS" : "FAIL"}`);
  md.push(`- Console errors: ${consoleErrors.length} / Failed requests: ${failedRequests.length}`);
  md.push("");
  md.push("## Step-by-step\n");
  for (const s of steps) {
    md.push(`### ${s.name} — ${s.status}`);
    for (const n of s.notes) md.push(`- ${n}`);
    if (s.error) md.push(`- ERROR: ${s.error}`);
    md.push("");
  }
  md.push("## Console errors");
  if (!consoleErrors.length) md.push("- none");
  else for (const e of consoleErrors.slice(0, 30)) md.push(`- ${e.url} :: ${e.text}`);
  md.push("");
  md.push("## Page errors");
  if (!pageErrors.length) md.push("- none");
  else for (const e of pageErrors.slice(0, 30)) md.push(`- ${e.url} :: ${e.text}`);
  md.push("");
  md.push("## Failed network requests");
  if (!failedRequests.length) md.push("- none");
  else for (const f of failedRequests.slice(0, 50)) md.push(`- ${f.method} ${f.url} :: ${f.failure}`);
  md.push("");

  fs.writeFileSync(REPORT_PATH, md.join("\n"), "utf8");
  console.log(`\nReport written: ${REPORT_PATH}`);
})().catch((e) => {
  console.error("FATAL:", e);
  fs.writeFileSync(REPORT_PATH, `# Admin POV — fatal\n\n${String(e && e.stack ? e.stack : e)}\n`, "utf8");
  process.exit(1);
});
