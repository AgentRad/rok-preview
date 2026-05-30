// Find a non-quoteOnly product, add to cart, verify cart UX
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = 'https://rok-preview-git-claude-industrial-marketplace-rowau-agentrad.vercel.app';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
const log = [];
const failed = [];
p.on('console', (m) => { if (m.type() === 'error') log.push('CONSOLE: ' + m.text()); });
p.on('pageerror', (e) => log.push('PAGEERR: ' + e.message));
p.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });

// crawl catalog; iterate product links until we find one with "Add to cart" button
await p.goto(BASE + '/catalog', { waitUntil: 'networkidle', timeout: 20000 });
const hrefs = await p.locator('a[href^="/product/"]').evaluateAll(els => Array.from(new Set(els.map(e => e.getAttribute('href')))));
console.log('candidate products:', hrefs.length);
let chosen = null;
for (const h of hrefs.slice(0, 24)) {
  await p.goto(BASE + h, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const has = await p.locator('button:has-text("Add to cart")').count();
  if (has > 0) { chosen = h; break; }
}
console.log('chosen non-quoteOnly product:', chosen);
if (chosen) {
  await p.locator('button:has-text("Add to cart")').first().click();
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'test-runs/screenshots/anon/probe-added.png', fullPage: true });
  await p.goto(BASE + '/cart', { waitUntil: 'networkidle', timeout: 15000 });
  const cartTxt = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  console.log('cart body sample:', cartTxt.slice(0, 400));
  const checkoutBtns = await p.locator('a:has-text("Checkout"), button:has-text("Checkout"), a:has-text("Check out"), button:has-text("Proceed")').allTextContents();
  console.log('checkout-ish elements:', JSON.stringify(checkoutBtns));
  await p.screenshot({ path: 'test-runs/screenshots/anon/probe-cart-filled.png', fullPage: true });
  // Try checkout from cart
  const co = p.locator('a:has-text("Checkout"), button:has-text("Checkout"), a:has-text("Proceed")').first();
  if (await co.count() > 0) {
    await co.click({ timeout: 4000 }).catch(e => log.push('checkout click: ' + e.message));
    await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    console.log('after-checkout url:', p.url());
    const coTxt = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
    console.log('checkout body sample:', coTxt.slice(0, 400));
    await p.screenshot({ path: 'test-runs/screenshots/anon/probe-checkout-filled.png', fullPage: true });
  }
}
console.log('console/page errors:', log.length, JSON.stringify(log));
console.log('failed reqs:', failed.length, JSON.stringify(failed.slice(0, 20)));
await b.close();
