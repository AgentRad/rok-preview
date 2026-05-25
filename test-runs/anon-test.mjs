// Anonymous POV Playwright walk-through for PartsPort
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://rok-preview-git-claude-industrial-marketplace-rowau-agentrad.vercel.app';
const SCREENSHOT_DIR = path.resolve('test-runs/screenshots/anon');
const REPORT_PATH = path.resolve('test-runs/reports/anon.md');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const stepResults = [];

function recordStep(num, title, status, sawNotes, issues, screenshot) {
  stepResults.push({ num, title, status, sawNotes, issues, screenshot });
}

async function shot(page, name) {
  const p = path.join(SCREENSHOT_DIR, name);
  try { await page.screenshot({ path: p, fullPage: true }); } catch (e) { /* ignore */ }
  return `anon/${name}`;
}

async function gotoSafe(page, url, opts = {}) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000, ...opts });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    return true;
  } catch (e) {
    return false;
  }
}

(async () => {
  // Note: headed launch (`headless: false`) fails with "spawn UNKNOWN" inside the
  // sandboxed PowerShell shell, so we fall back to headless. Screenshots still capture
  // every step. (Smoke-tested: `headless: true` works; `headless: false` does not.)
  const browser = await chromium.launch({ headless: true, slowMo: 50 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(`[${page.url()}] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(`[${page.url()}] ${err.message}`);
  });
  page.on('response', (resp) => {
    const status = resp.status();
    if (status >= 400) {
      failedRequests.push({ url: resp.url(), status, route: new URL(resp.url()).pathname });
    }
  });

  // ---- 1. Homepage ----
  {
    const issues = [];
    const notes = [];
    let status = 'PASS';
    try {
      const ok = await gotoSafe(page, BASE + '/');
      if (!ok) { status = 'FAIL'; issues.push('Navigation timed out'); }
      const title = await page.title().catch(() => '');
      notes.push(`title="${title}"`);
      const hero = await page.locator('h1').first().textContent({ timeout: 5000 }).catch(() => null);
      notes.push(`hero h1="${(hero || '').trim().slice(0, 120)}"`);
      const navLinks = await page.locator('header a, nav a').count().catch(() => 0);
      notes.push(`header/nav links count=${navLinks}`);
      const footer = await page.locator('footer').count().catch(() => 0);
      notes.push(`footer present=${footer > 0}`);
      const ctaCount = await page.locator('a:has-text("Browse"), a:has-text("Catalog"), a:has-text("Get started"), a:has-text("Sign up")').count().catch(() => 0);
      notes.push(`CTA-like links=${ctaCount}`);
      if (!hero) { issues.push('No h1 found'); status = status === 'FAIL' ? 'FAIL' : 'PARTIAL'; }
    } catch (e) {
      status = 'FAIL'; issues.push(String(e.message));
    }
    const sc = await shot(page, '01-home.png');
    recordStep(1, 'Homepage /', status, notes, issues, sc);
  }

  // ---- 2. Catalog ----
  let firstProductHref = null;
  let secondProductHref = null;
  {
    const issues = [];
    const notes = [];
    let status = 'PASS';
    try {
      const ok = await gotoSafe(page, BASE + '/catalog');
      if (!ok) { status = 'FAIL'; issues.push('Catalog nav timed out'); }
      // product cards: ProductCard most likely renders an <a href="/product/..."> link
      const productLinks = page.locator('a[href^="/product/"]');
      const count = await productLinks.count().catch(() => 0);
      notes.push(`product card links=${count}`);
      if (count === 0) { issues.push('No product links rendered'); status = 'FAIL'; }
      // Capture first 2 product hrefs
      if (count > 0) firstProductHref = await productLinks.nth(0).getAttribute('href');
      if (count > 1) secondProductHref = await productLinks.nth(1).getAttribute('href');
      // Filters/sort
      const filterCount = await page.locator('aside a, aside button, select, [role="combobox"]').count().catch(() => 0);
      notes.push(`filter-ish elements=${filterCount}`);
      // Try a category link click (any aside link)
      const catLink = page.locator('aside a').first();
      if (await catLink.count() > 0) {
        const before = page.url();
        try {
          await catLink.click({ timeout: 4000 });
          await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
          notes.push(`after category click url=${page.url()}`);
        } catch (e) {
          issues.push('Category click failed: ' + e.message);
        }
      }
      // Pagination
      const paginationBtn = page.locator('a:has-text("2"), button:has-text("2"), nav a[href*="page=2"]').first();
      if (await paginationBtn.count() > 0) {
        notes.push('pagination present');
      } else {
        notes.push('no pagination visible (single page of results)');
      }
    } catch (e) {
      status = 'FAIL'; issues.push(String(e.message));
    }
    const sc = await shot(page, '02-catalog.png');
    recordStep(2, 'Catalog /catalog', status, notes, issues, sc);
  }

  // ---- 3. Two product pages ----
  for (let i = 0; i < 2; i++) {
    const href = i === 0 ? firstProductHref : secondProductHref;
    const issues = [];
    const notes = [];
    let status = 'PASS';
    if (!href) {
      status = 'FAIL';
      issues.push('No product href captured from catalog');
      const sc = await shot(page, `03-product-${i + 1}.png`);
      recordStep(3 + i * 0.1, `Product page #${i + 1}`, status, notes, issues, sc);
      continue;
    }
    try {
      await gotoSafe(page, BASE + href);
      notes.push(`url=${href}`);
      const h1 = await page.locator('h1').first().textContent({ timeout: 5000 }).catch(() => null);
      notes.push(`h1="${(h1 || '').trim().slice(0, 100)}"`);
      const images = await page.locator('main img, article img').count().catch(() => 0);
      notes.push(`images=${images}`);
      // Look for price ($, USD, "Price")
      const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
      const hasPrice = /\$\s?[0-9,]+/.test(bodyText);
      notes.push(`price-pattern=${hasPrice}`);
      // Specs - look for definition list or "Specifications" heading
      const specsHeading = await page.locator('h2:has-text("Spec"), h3:has-text("Spec"), :text("Specifications")').count().catch(() => 0);
      notes.push(`specs heading count=${specsHeading}`);
      // Add to cart
      const addBtn = page.locator('button:has-text("Add to cart"), button:has-text("Add to Cart")').first();
      const addCount = await addBtn.count();
      notes.push(`Add-to-cart buttons=${addCount}`);
      if (addCount === 0) { issues.push('No Add-to-cart button visible'); status = 'PARTIAL'; }
      // For product 1, leave it (we'll add to cart from product 2 below)
      if (i === 1 && addCount > 0) {
        try {
          await addBtn.click({ timeout: 4000 });
          await page.waitForTimeout(1200);
          notes.push('clicked add-to-cart on product 2');
        } catch (e) {
          issues.push('Add-to-cart click failed: ' + e.message);
        }
      }
    } catch (e) {
      status = 'FAIL'; issues.push(String(e.message));
    }
    const sc = await shot(page, `03-product-${i + 1}.png`);
    recordStep(3 + (i === 0 ? 0 : 0.5), `Product page #${i + 1}`, status, notes, issues, sc);
  }

  // ---- 4. Cart ----
  {
    const issues = [];
    const notes = [];
    let status = 'PASS';
    try {
      await gotoSafe(page, BASE + '/cart');
      const txt = await page.locator('body').innerText({ timeout: 4000 }).catch(() => '');
      notes.push(`cart body sample="${txt.replace(/\s+/g, ' ').slice(0, 180)}"`);
      const itemRows = await page.locator('table tbody tr, [data-testid="cart-item"], li').count().catch(() => 0);
      notes.push(`row-ish elements=${itemRows}`);
      const checkoutBtn = await page.locator('a:has-text("Checkout"), button:has-text("Checkout"), a:has-text("Check out")').count().catch(() => 0);
      notes.push(`checkout buttons=${checkoutBtn}`);
    } catch (e) {
      status = 'FAIL'; issues.push(String(e.message));
    }
    const sc = await shot(page, '04-cart.png');
    recordStep(4, 'Cart /cart', status, notes, issues, sc);
  }

  // ---- 5. Checkout (anonymous) ----
  {
    const issues = [];
    const notes = [];
    let status = 'PASS';
    try {
      await gotoSafe(page, BASE + '/checkout');
      const url = page.url();
      notes.push(`landed url=${url}`);
      const txt = await page.locator('body').innerText({ timeout: 4000 }).catch(() => '');
      notes.push(`checkout body sample="${txt.replace(/\s+/g, ' ').slice(0, 220)}"`);
      const loginRedirect = /login|sign in/i.test(url) || /sign in|log in to/i.test(txt);
      notes.push(`appears-to-be-login-walled=${loginRedirect}`);
    } catch (e) {
      status = 'FAIL'; issues.push(String(e.message));
    }
    const sc = await shot(page, '05-checkout.png');
    recordStep(5, 'Checkout /checkout', status, notes, issues, sc);
  }

  // ---- 6. Login + Register ----
  {
    const issues = [];
    const notes = [];
    let status = 'PASS';
    try {
      await gotoSafe(page, BASE + '/login');
      const emailInput = await page.locator('input[type="email"], input[name="email"]').count();
      const pwInput = await page.locator('input[type="password"]').count();
      notes.push(`/login: email inputs=${emailInput}, password inputs=${pwInput}`);
      if (emailInput === 0 || pwInput === 0) { issues.push('/login missing inputs'); status = 'PARTIAL'; }
      // Submit blank
      const submit = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first();
      if (await submit.count() > 0) {
        await submit.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(800);
        const txt = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
        const hasValidation = /required|invalid|enter|please/i.test(txt);
        notes.push(`/login blank submit -> validation visible=${hasValidation}`);
      }
    } catch (e) {
      status = 'FAIL'; issues.push(String(e.message));
    }
    const sc1 = await shot(page, '06a-login.png');

    try {
      await gotoSafe(page, BASE + '/register');
      const inputs = await page.locator('input').count();
      notes.push(`/register: input count=${inputs}`);
      const submit = page.locator('button[type="submit"], button:has-text("Sign up"), button:has-text("Create")').first();
      if (await submit.count() > 0) {
        await submit.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(800);
        const txt = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
        const hasValidation = /required|invalid|enter|please/i.test(txt);
        notes.push(`/register blank submit -> validation visible=${hasValidation}`);
      } else {
        issues.push('/register has no submit button');
      }
    } catch (e) {
      status = 'FAIL'; issues.push('/register: ' + e.message);
    }
    const sc2 = await shot(page, '06b-register.png');
    recordStep(6, 'Login + Register', status, notes, issues, `${sc1.replace('anon/', '')} & ${sc2.replace('anon/', '')}`);
  }

  // ---- 7. Forgot password ----
  {
    const issues = [];
    const notes = [];
    let status = 'PASS';
    try {
      await gotoSafe(page, BASE + '/forgot-password');
      const email = await page.locator('input[type="email"], input[name="email"]').count();
      notes.push(`email input present=${email > 0}`);
      if (email === 0) { issues.push('No email input on /forgot-password'); status = 'PARTIAL'; }
    } catch (e) {
      status = 'FAIL'; issues.push(String(e.message));
    }
    const sc = await shot(page, '07-forgot-password.png');
    recordStep(7, 'Forgot password /forgot-password', status, notes, issues, sc);
  }

  // ---- 8. Marketing pages ----
  for (const [i, route] of [['/how-it-works'], ['/manufacturers'], ['/suppliers']].entries()) {
    const r = route[0];
    const issues = [];
    const notes = [];
    let status = 'PASS';
    try {
      await gotoSafe(page, BASE + r);
      const h1 = await page.locator('h1').first().textContent({ timeout: 4000 }).catch(() => null);
      notes.push(`h1="${(h1 || '').trim().slice(0, 100)}"`);
      const bodyLen = (await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')).length;
      notes.push(`body text length=${bodyLen}`);
      if (!h1 || bodyLen < 200) { issues.push('Looks thin/broken'); status = 'PARTIAL'; }
    } catch (e) {
      status = 'FAIL'; issues.push(String(e.message));
    }
    const sc = await shot(page, `08-${r.replace(/\//g, '')}.png`);
    recordStep(8 + i * 0.1, `Marketing ${r}`, status, notes, issues, sc);
  }

  // ---- 9. Search ----
  {
    const issues = [];
    const notes = [];
    let status = 'PASS';
    try {
      await gotoSafe(page, BASE + '/');
      const searchBox = page.locator('input[name="q"], input[type="search"], input[placeholder*="Search" i]').first();
      if (await searchBox.count() === 0) {
        issues.push('No search input found in nav');
        status = 'FAIL';
      } else {
        await searchBox.fill('500 kVA transformer');
        await searchBox.press('Enter');
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        notes.push(`search-result url=${page.url()}`);
        const productCount = await page.locator('a[href^="/product/"]').count().catch(() => 0);
        notes.push(`product result links=${productCount}`);
        const txt = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
        const aiHint = /AI|semantic|smart|relevance/i.test(txt);
        notes.push(`AI/semantic mention in text=${aiHint}`);
        if (productCount === 0) { issues.push('Zero results for "500 kVA transformer"'); status = 'PARTIAL'; }
      }
    } catch (e) {
      status = 'FAIL'; issues.push(String(e.message));
    }
    const sc = await shot(page, '09-search.png');
    recordStep(9, 'Search (top nav, real query)', status, notes, issues, sc);
  }

  // ---- 10. Random poking: collect anchors, click a couple, look for 404s ----
  {
    const issues = [];
    const notes = [];
    let status = 'PASS';
    try {
      await gotoSafe(page, BASE + '/');
      // Get all internal links
      const hrefs = await page.locator('a[href]').evaluateAll((els) =>
        Array.from(new Set(els.map((e) => e.getAttribute('href')).filter((h) => h && (h.startsWith('/') && !h.startsWith('//')))))
      );
      notes.push(`unique internal anchors on home=${hrefs.length}`);
      // Visit up to 5 unseen marketing-ish ones
      const seen = new Set(['/', '/catalog', '/cart', '/checkout', '/login', '/register', '/forgot-password', '/how-it-works', '/manufacturers', '/suppliers']);
      const toVisit = hrefs.filter((h) => !seen.has(h) && !h.startsWith('/product/') && !h.startsWith('#') && !h.startsWith('/api')).slice(0, 5);
      notes.push(`random anchors visiting=${JSON.stringify(toVisit)}`);
      for (const h of toVisit) {
        try {
          await gotoSafe(page, BASE + h);
          const t = await page.title().catch(() => '');
          const txt = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
          const is404 = /404|not found|page not found/i.test(t) || /404|not found/i.test(txt.slice(0, 200));
          notes.push(`${h} -> title="${t}" 404=${is404}`);
          if (is404) issues.push(`${h} returned 404`);
        } catch (e) {
          issues.push(`${h} failed: ${e.message}`);
        }
      }
    } catch (e) {
      status = 'FAIL'; issues.push(String(e.message));
    }
    const sc = await shot(page, '10-random.png');
    recordStep(10, 'Random poking', status, notes, issues, sc);
  }

  await context.close();
  await browser.close();

  // ---- Write report ----
  const passed = stepResults.filter((s) => s.status === 'PASS').length;
  const failed = stepResults.filter((s) => s.status === 'FAIL').length;
  const partial = stepResults.filter((s) => s.status === 'PARTIAL').length;

  let md = `# Anonymous POV — Test Report\n\n`;
  md += `## Summary\n`;
  md += `- Steps run: ${stepResults.length} / 10\n`;
  md += `- Passed: ${passed}\n`;
  md += `- Partial: ${partial}\n`;
  md += `- Failed: ${failed}\n`;
  md += `- Console errors: ${consoleErrors.length}\n`;
  md += `- Page errors: ${pageErrors.length}\n`;
  md += `- Failed network requests: ${failedRequests.length}\n\n`;
  md += `## Step-by-step\n\n`;

  for (const s of stepResults) {
    md += `### ${s.num}. ${s.title}\n`;
    md += `- Status: **${s.status}**\n`;
    md += `- What I saw:\n`;
    for (const n of s.sawNotes) md += `  - ${n}\n`;
    if (s.issues.length) {
      md += `- Issues:\n`;
      for (const i of s.issues) md += `  - ${i}\n`;
    } else {
      md += `- Issues: (none)\n`;
    }
    md += `- Screenshot: anon/${typeof s.screenshot === 'string' ? s.screenshot.replace(/^anon\//, '') : s.screenshot}\n\n`;
  }

  md += `## Console errors (raw)\n`;
  if (consoleErrors.length === 0) md += `(none)\n`;
  for (const e of consoleErrors.slice(0, 60)) md += `- ${e}\n`;
  if (consoleErrors.length > 60) md += `- …and ${consoleErrors.length - 60} more\n`;
  md += `\n## Page errors (raw)\n`;
  if (pageErrors.length === 0) md += `(none)\n`;
  for (const e of pageErrors.slice(0, 30)) md += `- ${e}\n`;
  md += `\n## Failed network requests\n`;
  if (failedRequests.length === 0) md += `(none)\n`;
  const seenReq = new Set();
  for (const r of failedRequests) {
    const key = `${r.status} ${r.route}`;
    if (seenReq.has(key)) continue;
    seenReq.add(key);
    md += `- ${r.status} ${r.route} (${r.url})\n`;
    if (seenReq.size >= 40) break;
  }

  // ---- Issues bucket: derived heuristically ----
  const critical = [];
  const high = [];
  const polish = [];
  for (const s of stepResults) {
    if (s.status === 'FAIL') {
      if ([1, 2, 4, 5].some((n) => n === Math.floor(s.num))) {
        critical.push(`Step ${s.num} (${s.title}) FAILED: ${s.issues.join('; ')}`);
      } else {
        high.push(`Step ${s.num} (${s.title}) FAILED: ${s.issues.join('; ')}`);
      }
    } else if (s.status === 'PARTIAL') {
      high.push(`Step ${s.num} (${s.title}) PARTIAL: ${s.issues.join('; ')}`);
    }
  }
  // Console errors -> high or polish based on count
  if (consoleErrors.length > 0) {
    (consoleErrors.length > 5 ? high : polish).push(`${consoleErrors.length} console error(s) across pages`);
  }
  if (pageErrors.length > 0) {
    critical.push(`${pageErrors.length} uncaught page error(s)`);
  }
  if (failedRequests.length > 0) {
    const fives = failedRequests.filter((r) => r.status >= 500).length;
    if (fives > 0) critical.push(`${fives} 5xx network response(s)`);
    const fours = failedRequests.length - fives;
    if (fours > 0) polish.push(`${fours} 4xx network response(s) (often expected: missing images, auth-gated APIs)`);
  }

  md += `\n## Issues found (prioritized)\n`;
  md += `### CRITICAL (blocks core flow)\n`;
  if (critical.length === 0) md += `(none)\n`;
  critical.forEach((c, i) => { md += `${i + 1}. ${c}\n`; });
  md += `\n### HIGH (degrades UX significantly)\n`;
  if (high.length === 0) md += `(none)\n`;
  high.forEach((c, i) => { md += `${i + 1}. ${c}\n`; });
  md += `\n### POLISH (cosmetic / minor)\n`;
  if (polish.length === 0) md += `(none)\n`;
  polish.forEach((c, i) => { md += `${i + 1}. ${c}\n`; });

  md += `\n## Green-flagged (worked perfectly)\n`;
  for (const s of stepResults.filter((s) => s.status === 'PASS')) {
    md += `- Step ${s.num}: ${s.title}\n`;
  }

  fs.writeFileSync(REPORT_PATH, md, 'utf8');
  console.log('REPORT WRITTEN:', REPORT_PATH);
  console.log('Steps:', stepResults.length, 'pass=', passed, 'partial=', partial, 'fail=', failed);
  console.log('Console errors:', consoleErrors.length, 'page errors:', pageErrors.length, 'failed reqs:', failedRequests.length);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
