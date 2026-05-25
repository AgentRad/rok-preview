import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE = "https://rok-preview-git-claude-industrial-marketplace-rowau-agentrad.vercel.app";
const SHOTS = "C:/Users/radfe/rok-preview/test-runs/screenshots/supplier";
const REPORT = "C:/Users/radfe/rok-preview/test-runs/reports/supplier.md";

fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(path.dirname(REPORT), { recursive: true });

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const steps = [];

function log(step, status, detail) {
  const line = `[${status}] ${step}${detail ? " - " + detail : ""}`;
  console.log(line);
  steps.push({ step, status, detail: detail || "" });
}

async function shot(page, name) {
  try {
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  } catch (e) {
    console.log("screenshot failed", name, e.message);
  }
}

async function waitIdle(page) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
}

(async () => {
  const browser = await chromium.launch({ headless: true, slowMo: 100 });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));
  page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url()} - ${r.failure()?.errorText}`));
  page.on("response", (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });

  try {
    // 1. Login
    try {
      // pre-dismiss demo guide
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => {
        try { localStorage.setItem("partsport_demo_guide_v1", "1"); } catch {}
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitIdle(page);
      // make sure overlay is gone
      const overlay = page.locator(".dg-overlay");
      if (await overlay.count()) {
        await page.locator(".dg-close").click().catch(() => {});
      }
      await shot(page, "01-login");
      await page.fill('input[type="email"]', "supplier@partsport.example");
      await page.fill('input[type="password"]', "demo1234");
      await shot(page, "02-login-filled");
      // submit by pressing Enter on password input -> avoids ambiguous submit button
      await Promise.all([
        page.waitForURL(/\/(supplier|account|$)/i, { timeout: 15000 }).catch(() => {}),
        page.locator('input[type="password"]').press("Enter"),
      ]);
      await waitIdle(page);
      await shot(page, "03-after-login");
      const url = page.url();
      log("Login", url.includes("/login") ? "FAIL" : "PASS", `landed at ${url}`);
    } catch (e) {
      log("Login", "FAIL", e.message);
    }

    // 2. Supplier dashboard
    try {
      await page.goto(`${BASE}/supplier`, { waitUntil: "domcontentloaded" });
      await waitIdle(page);
      await shot(page, "04-supplier-dashboard");
      const title = await page.locator("h1").first().innerText().catch(() => "");
      const kpiCount = await page.locator(".kpi").count();
      const productCount = await page.locator('input.input-sm').count();
      log("Dashboard", "PASS", `h1="${title}", kpis=${kpiCount}, productInputs=${productCount}`);
    } catch (e) {
      log("Dashboard", "FAIL", e.message);
    }

    // 3. Edit a product (price/stock) - try saving small change to first row
    try {
      const saveBtn = page.locator('button:has-text("Save")').first();
      const priceInput = page.locator('input.input-sm').first();
      const beforeVal = await priceInput.inputValue().catch(() => "");
      // tweak price by +0.01 then revert
      if (beforeVal) {
        const newVal = (Number(beforeVal) + 0.01).toFixed(2);
        await priceInput.fill(newVal);
        await shot(page, "05-product-edited");
        if (await saveBtn.count()) {
          await saveBtn.click();
          await page.waitForTimeout(1500);
          await shot(page, "06-product-saved");
          // revert
          await priceInput.fill(beforeVal);
          await saveBtn.click();
          await page.waitForTimeout(1200);
          log("Product edit", "PASS", `price ${beforeVal} -> ${newVal} -> ${beforeVal}`);
        } else {
          log("Product edit", "FAIL", "no Save button");
        }
      } else {
        log("Product edit", "FAIL", "no price input found");
      }
    } catch (e) {
      log("Product edit", "FAIL", e.message);
    }

    // 3b. Image manager - try clicking 'Manage' on first product
    try {
      const manageBtn = page.locator('button:has-text("Manage")').first();
      if (await manageBtn.count()) {
        await manageBtn.click();
        await page.waitForTimeout(800);
        await shot(page, "07-image-manager-open");
        // look for file input
        const fileInputs = await page.locator('input[type="file"]').count();
        log("Image manager UI", "PASS", `file inputs visible: ${fileInputs}`);
        // try upload
        const tinyPng = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
          "base64"
        );
        const pngPath = "C:/Users/radfe/rok-preview/test-runs/test-img.png";
        fs.writeFileSync(pngPath, tinyPng);
        const fi = page.locator('input[type="file"]').first();
        if (await fi.count()) {
          await fi.setInputFiles(pngPath);
          await page.waitForTimeout(2500);
          await shot(page, "08-image-uploaded");
          log("Image upload", "PASS", "submitted PNG");
        } else {
          log("Image upload", "FAIL", "no file input");
        }
      } else {
        log("Image manager UI", "FAIL", "no Manage button");
      }
    } catch (e) {
      log("Image upload", "FAIL", e.message);
    }

    // 4. CSV import - find textarea
    try {
      await page.goto(`${BASE}/supplier`, { waitUntil: "domcontentloaded" });
      await waitIdle(page);
      // CSV import is on dashboard
      const csvHeader = page.locator('h2:has-text("Bulk catalog import")');
      const hasHeader = await csvHeader.count();
      if (hasHeader) {
        await csvHeader.scrollIntoViewIfNeeded();
        await shot(page, "09-csv-import-section");
        const taCount = await page.locator("textarea").count();
        const ta = page.locator("textarea").nth(Math.max(0, taCount - 1));
        if (await ta.count()) {
          await ta.click();
          await ta.fill("sku,name,category,manufacturer,price,unit,etaDays,stock,quoteOnly,description\nTEST-SUP-001,Test SKU Supplier POV,Metering,GenericMfg,19.99,each,7,3,false,Test row from supplier POV.\n");
          await page.waitForTimeout(300);
          await shot(page, "10-csv-filled");
          // find "Preview" or similar button
          const previewBtn = page.locator('button:has-text("Preview")').first();
          if (await previewBtn.count()) {
            await previewBtn.click();
            await page.waitForTimeout(2000);
            await shot(page, "11-csv-previewed");
            log("CSV preview", "PASS", "preview shown");
          } else {
            log("CSV preview", "FAIL", "no Preview button");
          }
        } else {
          log("CSV import UI", "FAIL", "no textarea");
        }
      } else {
        log("CSV import UI", "FAIL", "no Bulk catalog import section");
      }
    } catch (e) {
      log("CSV import", "FAIL", e.message);
    }

    // 5. Orders - look at incoming orders
    try {
      const orderRows = page.locator('h2:has-text("Incoming orders") ~ * tr');
      const oc = await orderRows.count();
      const fulfillBtn = page.locator('button:has-text("Mark shipped"), button:has-text("Fulfill"), button:has-text("Shipped")').first();
      const hasFulfill = await fulfillBtn.count();
      await shot(page, "12-orders-section");
      log("Orders section", "PASS", `rows=${oc}, fulfillButtons=${hasFulfill}`);
      if (hasFulfill) {
        // click and observe but don't necessarily confirm
        await fulfillBtn.scrollIntoViewIfNeeded();
        await fulfillBtn.click();
        await page.waitForTimeout(1500);
        await shot(page, "13-fulfill-clicked");
        // look for tracking input or modal
        const trackingInputs = await page.locator('input[name*="track" i], input[placeholder*="track" i], input[placeholder*="carrier" i]').count();
        log("Fulfill flow", "PASS", `tracking inputs visible: ${trackingInputs}`);
        // dismiss any modal
        await page.keyboard.press("Escape").catch(() => {});
      } else {
        log("Fulfill flow", "SKIP", "no fulfillable orders");
      }
    } catch (e) {
      log("Orders", "FAIL", e.message);
    }

    // 6. RFQs - find quotes section
    try {
      const qHeader = page.locator('h2:has-text("Quote requests")');
      const qc = await qHeader.count();
      if (qc) {
        await qHeader.scrollIntoViewIfNeeded();
        await shot(page, "14-quotes-section");
        // QuoteResponder buttons
        const respondBtn = page.locator('button:has-text("Respond"), button:has-text("Quote"), button:has-text("Send")').first();
        const respondCnt = await respondBtn.count();
        log("RFQ section", "PASS", `header visible, respond-like buttons=${respondCnt}`);
        // try to expand a quote responder if any open
        const responder = page.locator('section, div').filter({ hasText: "OPEN" }).first();
      } else {
        log("RFQ section", "FAIL", "no Quote requests header");
      }
    } catch (e) {
      log("RFQ", "FAIL", e.message);
    }

    // 7. Payouts
    try {
      const payHeader = page.locator('h2:has-text("Payouts")');
      const pc = await payHeader.count();
      if (pc) {
        await payHeader.scrollIntoViewIfNeeded();
        await shot(page, "15-payouts-section");
        log("Payouts view", "PASS", "section visible");
      } else {
        log("Payouts view", "FAIL", "no payouts header (perhaps role lacks permission)");
      }
    } catch (e) {
      log("Payouts", "FAIL", e.message);
    }

    // 8. Profile - logo + supplier data, GET/PATCH /api/supplier/profile
    try {
      const profileHead = page.locator('h2:has-text("Profile")');
      await profileHead.scrollIntoViewIfNeeded();
      await shot(page, "16-profile-section");
      // PATCH no-op (description set to current/same) to test profile edit endpoint
      const apiRes = await page.evaluate(async () => {
        const r = await fetch("/api/supplier/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: "Trusted distributor of utility-grade equipment." }),
        });
        return { status: r.status, body: (await r.text()).slice(0, 200) };
      });
      log("Profile API PATCH", apiRes.status < 400 ? "PASS" : "FAIL", `status=${apiRes.status}, body=${apiRes.body}`);
    } catch (e) {
      log("Profile", "FAIL", e.message);
    }

    // 9. Team - invite teammate
    try {
      const teamHead = page.locator('h2:has-text("Team")');
      await teamHead.scrollIntoViewIfNeeded();
      await shot(page, "17-team-section");
      const emailInput = page.locator('input[type="email"]').last();
      const sendInviteBtn = page.locator('button:has-text("Invite"), button:has-text("Send invite")').first();
      if ((await emailInput.count()) && (await sendInviteBtn.count())) {
        await emailInput.fill("test-invitee+supplierpov@partsport.example");
        await shot(page, "18-invite-filled");
        await sendInviteBtn.click();
        await page.waitForTimeout(1800);
        await shot(page, "19-invite-sent");
        log("Team invite", "PASS", "invite submitted");
      } else {
        log("Team invite", "FAIL", `email input found=${await emailInput.count()}, invite btn=${await sendInviteBtn.count()}`);
      }
      // GET /api/supplier/team
      const t = await page.evaluate(async () => {
        const r = await fetch("/api/supplier/team");
        return { status: r.status, body: await r.text() };
      });
      log("Team API GET", t.status < 400 ? "PASS" : "FAIL", `status=${t.status}`);
    } catch (e) {
      log("Team", "FAIL", e.message);
    }

    // 10. Settings + 2FA
    try {
      await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
      await waitIdle(page);
      await shot(page, "20-settings");
      const bodyText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
      const has2fa = /2fa|two[- ]factor|authenticator/.test(bodyText);
      const hasPw = /password/.test(bodyText);
      log("Settings page", "PASS", `2fa=${has2fa}, password=${hasPw}`);
    } catch (e) {
      log("Settings", "FAIL", e.message);
    }

    // 11. Orders CSV export
    try {
      const r = await page.evaluate(async () => {
        const res = await fetch("/api/supplier/orders.csv");
        const text = await res.text();
        return { status: res.status, ctype: res.headers.get("content-type"), len: text.length, head: text.slice(0, 200) };
      });
      log("Orders CSV", r.status < 400 ? "PASS" : "FAIL", `status=${r.status}, type=${r.ctype}, len=${r.len}, head=${r.head.replace(/\n/g, "\\n").slice(0, 100)}`);
    } catch (e) {
      log("Orders CSV", "FAIL", e.message);
    }

    // 12. /account from supplier side
    try {
      await page.goto(`${BASE}/account`, { waitUntil: "domcontentloaded" });
      await waitIdle(page);
      await shot(page, "21-account-as-supplier");
      const h = await page.locator("h1").first().innerText().catch(() => "");
      log("/account as supplier", "PASS", `h1=${h}`);
    } catch (e) {
      log("/account as supplier", "FAIL", e.message);
    }

    // 13. Catalog import API direct
    try {
      const ci = await page.evaluate(async () => {
        const res = await fetch("/api/supplier/catalog-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv: "sku,name,price,stock\nSPV-T-1,Supplier POV test row,9,1\n", commit: false }),
        });
        const text = await res.text();
        return { status: res.status, body: text.slice(0, 400) };
      });
      log("catalog-import API (dry)", ci.status < 400 ? "PASS" : "FAIL", `status=${ci.status}, body=${ci.body}`);
    } catch (e) {
      log("catalog-import API", "FAIL", e.message);
    }
  } finally {
    await shot(page, "99-final");
    await browser.close();
  }

  // Write report
  const lines = [];
  lines.push("# Supplier POV - Test Report");
  lines.push("");
  const summary = Object.fromEntries(steps.map((s) => [s.step, s.status]));
  lines.push("## Summary");
  lines.push(`- Login: ${summary["Login"] || "?"}`);
  lines.push(`- Dashboard accessible: ${summary["Dashboard"] === "PASS" ? "yes" : "no"}`);
  lines.push(`- Product edit: ${summary["Product edit"] || "?"}`);
  lines.push(`- Image upload: ${summary["Image upload"] || "?"}`);
  lines.push(`- CSV preview: ${summary["CSV preview"] || "?"}`);
  lines.push(`- Order fulfillment: ${summary["Fulfill flow"] || "?"}`);
  lines.push(`- Team invite: ${summary["Team invite"] || "?"}`);
  lines.push(`- Orders CSV export: ${summary["Orders CSV"] || "?"}`);
  lines.push(`- Console errors: ${consoleErrors.length} / Page errors: ${pageErrors.length} / Failed requests: ${failedRequests.length}`);
  lines.push("");
  lines.push("## Step-by-step");
  for (const s of steps) lines.push(`- **${s.step}** - ${s.status}${s.detail ? `: ${s.detail}` : ""}`);
  lines.push("");
  lines.push("## Console errors");
  if (!consoleErrors.length) lines.push("- none");
  else for (const e of consoleErrors.slice(0, 40)) lines.push(`- ${e}`);
  lines.push("");
  lines.push("## Page errors");
  if (!pageErrors.length) lines.push("- none");
  else for (const e of pageErrors.slice(0, 40)) lines.push(`- ${e}`);
  lines.push("");
  lines.push("## Failed network requests");
  if (!failedRequests.length) lines.push("- none");
  else for (const e of failedRequests.slice(0, 60)) lines.push(`- ${e}`);
  fs.writeFileSync(REPORT, lines.join("\n"));
  console.log("Wrote", REPORT);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
