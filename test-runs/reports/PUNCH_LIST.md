# PartsPort Testing Team Run, 2026-05-24

Five POVs walked the live preview at `https://rok-preview-git-claude-industrial-marketplace-rowau-agentrad.vercel.app` in parallel. Individual reports: `anon.md`, `buyer.md`, `supplier.md`, `admin.md`, `oem.md`. Screenshots under `test-runs/screenshots/<pov>/`.

## Headline

Marketplace works end-to-end. Anon can browse and add to cart. Buyer can complete the full path up to the Stripe redirect. Supplier dashboard is functional with healthy APIs. Admin console is the most polished surface, including a standout "Manage as" impersonation UX. OEM dashboard renders but has the biggest gap-to-pitch of any persona.

Critical findings cluster in two places: the demo-guide modal blocking first-visit interaction across every persona, and the OEM dashboard not actually delivering on two of its four pillars.

## CRITICAL, fix before any external demo

### C1. DemoGuide overlay traps first-visit interaction across the whole app
Flagged by anon, buyer, supplier, and admin testers. The `.dg-overlay` div from `src/components/DemoGuide.tsx` (CSS at `src/app/globals.css:1156`) covers the viewport on first load and intercepts every pointer event including the Sign in button. The buyer tester's first run hung 30 seconds on this until it pre-set `localStorage.partsport_demo_guide_v1 = "1"`. A real first-time visitor with reduced motion, a screen reader, or just average attention will get stuck. Fix options: close on Escape key, dismiss on first scroll, make the surrounding overlay `pointer-events: none` and keep the dialog box itself blocking, or skip the overlay entirely on `/login` and `/register`.

### C2. OEM demand intelligence leaks across all manufacturers
`src/app/oem/page.tsx:51` queries `prisma.searchEvent.findMany({ orderBy: createdAt desc, take: 80 })` with no `where` clause. Every manufacturer sees every other manufacturer's buyer searches, including stray paths the test runners typed into the search box (the top row in live data is literally `/admin`). The whole "demand intelligence, with no channel conflict" pitch on `/manufacturers` is undermined by one missing filter. Either join through `Product.manufacturer === brand` plus a category-keyword heuristic, or at minimum gate on queries containing the brand or one of its category keywords.

### C3. OEM public storefront does not exist
The `/manufacturers` marketing page promises "A storefront you control." There is no `/manufacturers/[slug]` route, no `/brand/[slug]` route, no link out of `/oem` to a public-facing Siemens page, and no edit UI to populate one. A Siemens product manager looking for the storefront they were sold would not find one. This is the single biggest gap between the pitch and what's built. Either build the route plus an edit UI in `/oem`, or remove the storefront pillar from `/manufacturers`.

## HIGH, fix this sprint

### H1. OEM can navigate to `/cart` and `/checkout`
`/supplier`, `/admin`, `/ops` correctly redirect a MANUFACTURER session to `/`. `/cart` and `/checkout` do not. They render harmlessly because the OEM has no items, but role gating should be consistent. Add MANUFACTURER to the redirect list on those two pages.

### H2. React hydration error #418 on `/orders/[id]`
Buyer tester logged the error twice on every order detail page load (verifiable in browser console). Server-rendered markup diverges from client. Likely a date/timezone formatting call or a `Date.now()` / `Math.random()` derived value rendered server-side. The page is rich (timeline, message thread, cancel button, review CTAs), so a hydration mismatch can silently drop interactivity on the affected subtree.

### H3. `/account` shows the buyer "My orders" page for supplier and OEM sessions
Both non-buyer testers landed on a page that says "Signed in as Sam Rivera, Order parts" / "Signed in as Morgan Reed, No payments due, no quotes waiting, no shipments arriving today." Suppliers and manufacturers do not buy on the marketplace, so the buyer dashboard is the wrong default. Either redirect SUPPLIER and MANUFACTURER roles from `/account` to `/supplier` and `/oem` respectively, or hide the buyer-specific blocks and link back to the role-appropriate dashboard.

### H4. Logo uploader rejection message is misleading
Profile logo uploader rejects sub-200px PNGs with "File is empty or corrupted." It is not empty and not corrupted, it is below the documented 200x200 minimum. Real suppliers with smaller source assets will not understand why. Change to "Image is too small. Minimum 200x200 pixels."

### H5. Inconsistent image validation between profile logo and product images
Profile logo enforces 200x200 minimum. Product image manager accepted a 1x1 PNG without complaint and rendered it as a thumbnail. Either tighten product-image validation to match, or document why the rules differ.

### H6. Stripe-only payment path with no recovery
When `STRIPE_SECRET_KEY` is set, the UI hides both the demo fallback (correct) and PayPal (because PayPal env is not set). A buyer with a temporarily unreachable Stripe session has no recovery beyond "Could not start checkout." For B2B procurement, consider keeping a "Pay later via wire" or "Send invoice" path so a buyer can complete the order async.

### H7. AI search under-returns for "500 kVA transformer"
Real industrial query yields one product when the catalog seed has multiple transformers including 75 kVA. Either widen the semantic threshold in `src/lib/search.ts`, or fall back to broader keyword matching when result count is 1 or fewer.

### H8. Default catalog sort surfaces quote-only items first
First 2 to 4 tiles in the default sort are all `quoteOnly` (Transformer, Vacuum CB Switchgear, Diesel Generator). A first-time buyer expecting "shop" lands on pages with no Add to cart, just Request a quote. Either rearrange the default sort to mix in-stock products at the top, or visibly label quote-only tiles on the catalog grid so buyers can self-route.

### H9. Seed has zero pending supplier applications
Admin's headline workflow (approve, fire `sendApplicationStatus` email, surface the new login + temp password) cannot be demoed because `SupplierApplication.status === "PENDING"` returns nothing. Seed one or two pending applications so the Admin overview tells a story.

## MEDIUM and POLISH, opportunistic fixes

### M1. Admin Suppliers Edit form missing operational fields
Only `name / contactEmail / logoUrl / website / description / certifications` are editable inline. No UI for `verified`, `status` (APPROVED / SUSPENDED), `feeBps`, `rating`, or `onTimeRate`, even though the schema and KPIs reference them. Either expose them or document they are intentionally seed-only.

### M2. Admin Attention feed shows supplier-team chores
"2 team invites not yet accepted" is supplier work, not admin work. Tighten `getAdminAttention()` to truly admin-actionable items, or scope cross-tenant items behind "Manage as" only.

### M3. Top OEM demand-signal row is `/admin`
Even after C2 is fixed, the system should sanitize obvious junk (paths starting with `/`, single-character queries, etc.) before surfacing them as demand signal.

### M4. Header still shows "For suppliers" and "For manufacturers" when signed in as that role
Same nav for everyone. Once role is known, swap those slots for "Supplier dashboard" / "Manufacturer dashboard" or hide them.

### M5. Supplier checklist counts "3 of 5 complete" while the supplier already has a logo, products, and certifications
Looks like seed leaves `website` and one other string field blank. Either seed them, or relabel "Get set up" as "Optional polish steps" so the user does not think something is wrong.

### M6. `/checkout` flashes "Loading checkout..." instead of a skeleton
First impression on a critical conversion page. A proper skeleton or instant render with hydrating values would feel less raw.

### M7. `AttentionFeed` empty on `/oem` despite searches like "transformer," "circuit breaker," "500 kVA transformer" in the log
After C2 is fixed, double-check `getManufacturerAttention` brand-matching logic. Most likely too strict.

### P1. CSV filenames use UTC date
On 2026-05-24 23:xx local time the file is named `partsport-invoices-2026-05-25.csv`. Use local date for the filename or note UTC in the filename suffix.

### P2. Ops KPI subtitle is misleading
"OPEN ORDERS, paid, not yet delivered" counts `status === "PAID"` regardless of shipment stage, so it does not change when an order advances New to Processing to Shipped. Either rename "Open paid orders" or filter on `shipmentStage !== "Delivered"`.

### P3. No "Reorder" CTA on past orders
Utilities buyers consuming the same maintenance parts monthly have to rebuild the cart each time. Worth a small button on `/orders/[id]` and `/account`.

### P4. Invoice page renders for PENDING orders with no DRAFT watermark
`/orders/[id]/invoice` returns a complete invoice even before payment. A buyer could send an unpaid invoice to their accountant. Add a "DRAFT" or "AWAITING PAYMENT" watermark gated on `order.status !== "PAID"`.

### P5. Order detail "Awaiting payment" banner has no resume link
A buyer landing on a PENDING order from email or history has no obvious way to resume payment. Add a "Resume payment" link that hits `/api/payments/create-session`.

### P6. Cart is localStorage-only
Items disappear if the buyer switches devices or clears storage. Buyer is logged in by the time they reach `/cart`, so a server-side cart would survive sessions. Minor for preview-stage but worth a model for production.

### P7. Settings page subtitle shows raw lowercase role enum
"Signed in as Sam Rivera, supplier@partsport.example, supplier" with a lowercase "supplier" instead of the human label used elsewhere ("Owner", "Supplier", "Distributor").

### P8. Bulk catalog import has two textareas with no visual hierarchy
"Smart import (AI)" and manual CSV look identical. Adding a numbered "1." / "2." or a divider would help.

### P9. Login form submit button has no explicit `type="submit"`
Works because HTML default is submit, but it makes selectors fragile for tests and assistive tech.

## Green-flagged, working well

These came up unprompted across multiple testers and deserve credit:
- The "Manage as" impersonation banner on `/supplier` when triggered by admin. Admin tester called it "the clearest impersonation UX I've seen," with an unmistakable amber "Stop and return to admin" button.
- Server creates the order before the payment redirect, so a buyer who bounces from Stripe still has a recoverable order at `/orders/[id]`.
- Cart cost breakdown (subtotal, freight, platform fee, sales tax, total) with the "calculated at fulfillment" copy.
- CSV exports across admin (invoices.csv, orders.csv) and supplier (orders.csv) are real downloads with QuickBooks-friendly headers.
- The Authorized Distributors table on `/oem` is the strongest OEM pillar, rating + SKU count + stock all visible.
- Catalog AI search returns sensibly narrow results for "circuit breaker" (3 hits vs the 24 keyword would give).
- Address book CRUD works cleanly, address dropdown appears on checkout for logged-in buyers.
- RFQ flow is real and end-to-end on a quote-only product.
- Message thread on order detail sends and renders.
- No emojis, no em dashes spotted in copy across the app. House style holds.

## Environment notes

Playwright `chromium.launch({ headless: false })` failed on the subagent shells with `Error: browserType.launch: spawn UNKNOWN`. Headless launches fine. Likely Windows Defender or Controlled Folder Access blocking the binary at `%LOCALAPPDATA%\ms-playwright\chromium-1223\chrome-win64\chrome.exe`. To run headed for a visual demo, add `%LOCALAPPDATA%\ms-playwright` to Defender exclusions. All artifacts above were captured headless, same coverage.

Buyer tester also flagged 23 `OPTIONS /` preflights returning 400, and Admin flagged ~56 `ERR_ABORTED` RSC prefetches. Both are framework noise, not real failures.

## Suggested fix order

1. Demo-guide overlay (C1), one selector / CSS change, unblocks demos.
2. OEM demand-signals tenant scoping (C2), one query change.
3. OEM public storefront route + edit UI (C3) or trim the pitch.
4. Role gates on `/cart` and `/checkout` for MANUFACTURER (H1).
5. Hydration error on `/orders/[id]` (H2).
6. `/account` role-aware redirect for SUPPLIER and MANUFACTURER (H3).
7. Logo error message (H4) and image validation parity (H5).
8. Seed 1 to 2 pending supplier applications (H9).
9. Everything else opportunistically.
