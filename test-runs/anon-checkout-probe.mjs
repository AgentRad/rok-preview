import { chromium } from 'playwright';
const BASE = 'https://rok-preview-git-claude-industrial-marketplace-rowau-agentrad.vercel.app';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
async function dg() { const x = p.locator('button:has-text("Got it"), button.dg-close').first(); if (await x.count()) try{ await x.click({timeout:1500}); }catch{} }
await p.goto(BASE + '/product/SWG-CUT100', { waitUntil: 'networkidle', timeout: 15000 });
await dg();
await p.locator('button:has-text("Add to cart")').first().click();
await p.waitForTimeout(500);
await p.goto(BASE + '/cart', { waitUntil: 'networkidle', timeout: 15000 });
await dg();
console.log('at cart:', p.url());
const proceed = p.locator('a.btn:has-text("Proceed to checkout"), a:has-text("Proceed to checkout")').first();
const cnt = await proceed.count();
console.log('proceed link count:', cnt);
if (cnt > 0) {
  const href = await proceed.getAttribute('href');
  console.log('href attribute:', href);
  await Promise.all([
    p.waitForURL(/.*\/checkout.*/, { timeout: 8000 }).catch(e => console.log('waitForURL fail:', e.message)),
    proceed.click({ timeout: 4000 }).catch(e => console.log('click fail:', e.message)),
  ]);
  console.log('after click url:', p.url());
  const txt = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  console.log('after click body:', txt.slice(0, 400));
  await p.screenshot({ path: 'test-runs/screenshots/anon/probe-checkout-real.png', fullPage: true });
}
await b.close();
