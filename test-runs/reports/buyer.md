# Buyer POV — Test Report

## Summary
- Login: **PASS**
- Buy loop end-to-end: **PARTIAL** — order created server-side, but payment requires an external Stripe Checkout redirect that a buyer must complete manually. PayPal env not set; the demo fallback is hidden because `STRIPE_SECRET_KEY` is configured.
- Order created: **yes** — order ID `cmpkr3azk000akz04q3cayyib` (status remains PENDING because Stripe Checkout wasn't completed in the test).
- Console errors: **23** (all are CORS-style 400 OPTIONS preflights from a Vercel/dev probe to the root URL — not user-visible, see note below) / Failed network requests: **23** (same — every entry is `OPTIONS /` returning 400)
- Page errors: **2** — React minified error #418 (hydration mismatch) on `/orders/[id]`

## Step-by-step

### 01 — Login — PASS
`/login` rendered, `#email` / `#password` accepted the demo buyer creds, redirected to `/account`. (`screenshots/buyer/01-login-form.png`, `02-after-login.png`)
Issue: a "Demo guide" modal (`.dg-overlay`) auto-opens on first visit and **intercepts all clicks**, including the Sign-in button. The test had to pre-set `localStorage.partsport_demo_guide_v1=1` to dismiss it. A first-time real buyer must click the close X first. Worth verifying that the close button is keyboard-reachable.

### 02 — Account page — PASS
Loaded at 25 KB, shows the buyer's name, profile, address book, password section, sessions, and **order history with 12 entries** (the test orchestrated multiple runs). (`03-account.png`)

### 03 — Homepage — PASS
Hero + sections render. (`04-home.png`)

### 04 — Catalog browse — PASS
24 products on the default page (matches `PAGE_SIZE`). (`05-catalog.png`)

### 05 — Catalog search "circuit breaker" — PASS
Returned 3 products. AI search appears to be working (results are narrower than keyword would give). (`06-catalog-search.png`)

### 06 — Collect product hrefs (price-asc) — PASS
Cheap parts surfaced: `CBL-CTRL14` and `CND-ACSR397`. Default sort puts transformers/switchgear (quote-only) first — see HIGH issue below.

### 07 / 08 — Product page + Add to cart — PASS
Both products show price, supplier, qty stepper, "Add to cart" + "Buy now". Click added the SKUs to `localStorage.partsport_cart_v1`. Cart is **client-side only** (localStorage). (`07-product-1.png`, `09-product-2.png`)

### 09 — Cart page — PASS
Two cart lines render with thumbnails, price/unit, supplier, delivery ETA, qty stepper, Remove, and a totals card (subtotal / freight / platform fee / sales tax / total). (`10-cart.png`)

### 10 — Cart qty change — PASS
`+` button on qty stepper increased qty from 1 to 3 with live total recalculation. (`11-cart-qty-changed.png`) Remove buttons present (2). Not exercised to preserve cart for checkout.

### 11 — Checkout page loaded — PASS
Form rendered with `#cname`, `#cemail`, `#cship` and a "Saved addresses" dropdown (since the buyer was logged in). (`12-checkout-form.png`)

### 12 — Fill checkout form — PASS
Filled name / email / a multi-line shipping address, clicked "Continue to payment". The POST to `/api/orders` returned `orderId=cmpkr3azk000akz04q3cayyib`. (`13-checkout-filled.png`, `14-checkout-pay.png`)

### 13 — Payment — PARTIAL
Because `STRIPE_SECRET_KEY` is set in Vercel, the UI shows **only** "Pay by bank transfer or card · $X" which redirects to a hosted Stripe Checkout URL. The demo "Place order" fallback is hidden. PayPal is not configured (no `NEXT_PUBLIC_PAYPAL_CLIENT_ID`).
- Cannot auto-complete a real Stripe session in this test.
- Order is created **before** payment (status PENDING) — confirmed by visiting `/orders/{id}` directly.

### 14 — Order detail — PASS
`/orders/{id}` renders the order with reference, status badge (PENDING), itemized list, totals, address block, "Awaiting payment" banner, and the timeline (Paid → Processing → Shipped → Delivered). (`16-order-detail.png`)
**Page errors**: 2× React minified error #418 (hydration mismatch) fired on this page. Visible in browser console; the page still renders correctly so a buyer probably won't notice, but it points at server-rendered HTML diverging from client.

### 15 — Invoice — PASS
`/orders/{id}/invoice` renders a clean print-styled invoice (14.7 KB, contains the word "invoice"). (`17-invoice.png`) Invoice generates even for PENDING orders, which is fine for preview but might be worth gating on PAID in production.

### 16 — RFQ flow — PASS
Sorted catalog by price-desc, opened `GEN-DIESEL100` (a diesel generator priced > $3000). The product page replaced the cart UI with a **Request a quote** button. Clicking it opened a quote form (textarea + name/email), and submitting produced a success state. (`18`-`21`)

### 17 — Message thread — PASS
Order detail page includes a `MessageThread` component with a textarea + Send button at the bottom. Sent a test message to the supplier successfully. (`22-message-sent.png`)

### 18 — Account addresses + add new — PASS
`/account` includes an `AddressBook`. The "+ Add an address" button reveals a form (`#ad-label`, `#ad-recipient`, `#ad-company`, `#ad-line1`, `#ad-line2`, `#ad-city`, `#ad-region`, `#ad-postal`, `#ad-phone`). Filled all fields and saved via `button[type=submit]`. The address appeared in the list. (`23-account.png`, `24a-address-form-open.png`, `24-address-form.png`)

### 19 — Order history on /account — PASS
12 `/orders/{id}` links visible. The reference for the new order shows up in the page body.

### 20 — Review flow — PASS (informational)
On a fresh product page no "Write a review" CTA appears. This is **expected** per CLAUDE.md (reviews are only available for buyers with a **delivered** order for that product), and our test order is still PENDING. (`25-product-review-area.png`)

### 21 — Cancel / Return — PASS
Order detail page (PENDING status) shows a Cancel Order CTA (per `cancellable = status === "PENDING" || (PAID && not shipped/delivered)`). (`26-order-cancel.png`) Return path (`canOpenReturn`) only appears once `FULFILLED` / `Delivered`, so wasn't exercised in this run.

### 22 — Reorder — NOT FOUND
No "Reorder" CTA on order detail. There is no reorder feature in the current build. Minor polish gap.

### 23 — Final account view — PASS
Account page still shows full order history including the new order. (`28-final-account.png`)

## Issues found (prioritized)

### CRITICAL
*(none — the buy loop functions end-to-end up to the Stripe handoff)*

### HIGH
- **Demo Guide overlay blocks the Sign-in button on first visit.** `.dg-overlay` covers the entire viewport on first load (no `localStorage.partsport_demo_guide_v1` key). First-time buyers cannot click "Sign in" until they hit the X. The overlay closes on backdrop click too, but the UI nudges users into reading the steps first — there's no visual hint that the form behind is the actual target. Surface the close affordance (or auto-dismiss on first interaction). The first Playwright run failed for 30 s on this exact issue.
- **Hosted payment is the only path when Stripe is configured.** When `STRIPE_SECRET_KEY` is set, the UI removes the demo fallback (correct) but also removes PayPal (because PayPal env isn't set). A buyer with a temporarily unreachable Stripe session has no recovery path — clicking "Pay" calls `/api/payments/create-session` and on error just shows "Could not start checkout." Consider keeping at least a "Pay later via wire" option for enterprise procurement.
- **React hydration error (#418) on `/orders/[id]`.** Fires twice every page load. Server-rendered markup doesn't match client. Likely a date / timezone string or a `Math.random` / `Date.now`-derived value rendered server-side. Worth chasing because hydration mismatches in App Router can drop interactivity on the affected subtree (the order page is rich: timeline, message thread, cancel button, review buttons).

### POLISH
- **Default catalog sort hides addable products.** The first 2-4 catalog tiles by default sort are all `quoteOnly` (Transformer, Vacuum CB Switchgear, Diesel Generator). Their product pages don't show "Add to cart" or a price — only "Request a quote". A first-time visitor browsing the homepage to "buy something" hits a wall on the first product they click. Either show small/in-stock items at the top of the default sort, or label quote-only tiles on the catalog grid so buyers can self-route.
- **No "Reorder" button on past orders.** Brief calls this out as a desirable buyer feature; not built. Buyers who consume the same parts monthly (a real use case for utilities maintenance) have to rebuild the cart each time.
- **Invoice page renders for PENDING orders.** `/orders/{id}/invoice` returns a complete invoice even before the order is paid. Likely fine because there's no `Invoice` row yet (it's a derived view), but the print artifact has no "DRAFT" / "AWAITING PAYMENT" watermark to prevent a buyer from sending an unpaid invoice to their accountant.
- **Cart is localStorage-only.** Items disappear if the buyer switches devices or clears storage. The buyer is logged in by the time they reach `/cart`, so a server-side cart would survive sessions. Minor for now since this is preview-stage.
- **Address-book "Save" button text varies.** The form submit button is generic `<button type=submit>` rather than a labelled "Save address" — first run of the test missed it. Labelling helps assistive tech.
- **Order detail "Awaiting payment" banner has no CTA back to checkout.** A buyer landing on a PENDING order from email or history has no obvious way to resume payment. Add a "Resume payment" link.

## Console errors (raw)
All 23 console errors are the same pattern:
```
Failed to load resource: the server responded with a status of 400 ()
```
They correspond to **HTTP `OPTIONS /` preflights returning 400** issued on every page (see Failed network requests). These are **not user-visible** (page rendering is unaffected, no broken UI). Most likely cause: Vercel's edge or a browser extension issuing a probe; could also be Playwright/Chrome's connectivity check. Worth a one-line audit, but not a real bug. The only "real" errors are:

```
[/orders/cmpkr3azk000akz04q3cayyib] Minified React error #418  (×2)
```

## Failed network requests
All 23 entries:
```
OPTIONS https://rok-preview-git-claude-industrial-marketplace-rowau-agentrad.vercel.app/ → 400
```
No `4xx`/`5xx` returned on any real API call (`/api/auth/login`, `/api/orders`, `/api/products/lookup`, `/api/addresses`, `/api/messages`, `/api/quotes` all 200'd). The hosted-payment redirect (`/api/payments/create-session`) was not exercised.

## Green-flagged
- Login + role-based redirect to `/account` works.
- AI catalog search returns sensible results for "circuit breaker" (3 narrow hits, not 24 broad ones).
- Product pages show price, supplier, manufacturer, ETA, stock status, qty stepper, and switch to a quote-only path automatically for high-ticket items.
- Cart computes platform fee + freight + sales tax line items with helpful "calculated at fulfillment" copy.
- Checkout pre-fills logged-in buyer's name/email and offers saved addresses.
- Server creates the order **before** payment redirect, so a buyer who bounces from Stripe still has a recoverable order.
- Order detail page shows the **Paid → Processing → Shipped → Delivered** timeline, status badge, itemized lines, totals, address block, message thread, cancel CTA (when applicable), and review CTAs (when delivered).
- Invoice renders cleanly and is print-styled.
- Address book CRUD works (add, default, delete) with proper field IDs.
- RFQ flow works end-to-end from product page → form → submit.
- Message thread on order page sends and renders.
- No emojis, no em dashes spotted in the UI copy (per house style).
