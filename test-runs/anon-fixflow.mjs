// Re-validate cart + checkout with DemoGuide dismissed.
import { chromium } from 'playwright';
const BASE = 'https://rok-preview-git-claude-industrial-marketplace-rowau-agentrad.vercel.app';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
const log = [];
p.on('console', (m) => { if (m.type() === 'error') log.push('CONSOLE: ' + m.text()); });
p.on('pageerror', (e) => log.push('PAGEERR: ' + e.message));
const failed = [];
p.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });

async function dismissGuide() {
  const gotIt = p.locator('button:has-text("Got it"), button.dg-close').first();
  if (await gotIt.count() > 0) { try { await gotIt.click({ timeout: 2000 }); } catch {} }
}

await p.goto(BASE + '/catalog', { waitUntil: 'networkidle', timeout: 20000 });
await dismissGuide();

const hrefs = await p.locator('a[href^="/product/"]').evaluateAll(els => Array.from(new Set(els.map(e => e.getAttribute('href')))));
let chosen = null;
for (const h of hrefs.slice(0, 24)) {
  await p.goto(BASE + h, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await dismissGuide();
  const has = await p.locator('button:has-text("Add to cart")').count();
  if (has > 0) { chosen = h; break; }
}
console.log('chosen:', chosen);
if (chosen) {
  await p.locator('button:has-text("Add to cart")').first().click({ timeout: 5000 });
  await p.waitForTimeout(700);
  const added = await p.locator('text=Added to cart').count();
  console.log('Added confirmation visible:', added);
  await p.screenshot({ path: 'test-runs/screenshots/anon/probe-added.png', fullPage: true });

  await p.goto(BASE + '/cart', { waitUntil: 'networkidle', timeout: 15000 });
  await dismissGuide();
  const cartTxt = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  console.log('cart sample:', cartTxt.slice(0, 350));
  const checkoutEls = await p.locator('a:has-text("Checkout"), button:has-text("Checkout"), a:has-text("Proceed"), button:has-text("Proceed")').allTextContents();
  console.log('checkout-like elements:', JSON.stringify(checkoutEls));
  await p.screenshot({ path: 'test-runs/screenshots/anon/probe-cart-filled.png', fullPage: true });

  const co = p.locator('a:has-text("Checkout"), button:has-text("Checkout"), a:has-text("Proceed"), button:has-text("Proceed")').first();
  if (await co.count() > 0) {
    await co.click({ timeout: 4000 }).catch(e => console.log('checkout click fail:', e.message));
    await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    console.log('post-checkout url:', p.url());
    const coTxt = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
    console.log('post-checkout body sample:', coTxt.slice(0, 350));
    await p.screenshot({ path: 'test-runs/screenshots/anon/probe-checkout-filled.png', fullPage: true });
  }
}
// Also re-run /login blank submit with guide dismissed
await p.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 15000 });
await dismissGuide();
const submit = p.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first();
if (await submit.count() > 0) {
  await submit.click({ timeout: 3000 }).catch(e => console.log('login submit fail:', e.message));
  await p.waitForTimeout(800);
  const html = await p.content();
  const txt = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  console.log('login blank submit url:', p.url(), 'has-validation:', /required|invalid|enter|please|error/i.test(txt));
  await p.screenshot({ path: 'test-runs/screenshots/anon/probe-login-blank.png', fullPage: true });
}

console.log('errors:', log.length, JSON.stringify(log));
console.log('failed reqs:', failed.length, JSON.stringify(failed));
await b.close();
