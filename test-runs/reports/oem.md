# OEM POV — Test Report

## Summary
- Login: PASS (oem@partsport.example, lands on /oem)
- /oem dashboard accessible: yes, with real seeded data
- Value prop alignment: **WEAK** — dashboard renders cleanly, but two of the four pillars (branded storefront, demand intelligence) are either missing or implemented in a way that breaks the promise
- No-sales-access confirmed: **partial** — /supplier, /admin, /ops all redirect; **/cart and /checkout are reachable as an OEM**
- Console errors: 0 / Page errors: 0 / Failed network requests: 15 (all are `net::ERR_ABORTED` on `_rsc` prefetch URLs during navigation, benign Next.js noise)

## OEM value-prop scorecard
- **Storefront** — MISSING. The OEM has no public branded URL. There is no `/manufacturers/siemens`, no `/storefront/siemens`, no link from `/oem` that leads anywhere a buyer or distributor could see "Siemens on PartsPort." The public `/manufacturers` page is a marketing pitch deck (six "Why list with us" tiles plus an application form), not a directory of manufacturers. A real Siemens product manager looking for the storefront they were sold would not find one.
- **Demand signals / search intelligence** — IMPLEMENTED BUT BROKEN. The "What buyers are searching for" table is populated (13 rows), but it is **not filtered by the OEM's brand or categories at all**. `src/app/oem/page.tsx:51` runs `prisma.searchEvent.findMany({ orderBy: createdAt desc, take: 80 })` with no `where` clause. Every manufacturer logging in sees the **same global search log**. The top row in the live data is literally `/admin` (someone typed it into the search box). This is the opposite of the channel-private intelligence the pitch promises. Also, the in-app `AttentionFeed` is empty ("No new demand signals.") so no curated alerts are surfaced either.
- **Authorized distributors** — STRONG. The KPI ("2 distributors carrying your brand") and the Authorized Distributors table both populate. Each row shows distributor name, rating, and how many Siemens SKUs they carry. The accompanying copy correctly emphasizes the anti-counterfeit / gray-market angle. **Stock levels are visible** in the separate "Your products on PartsPort" table (each row shows Listed-by + List price + Stock). This is the most credible part of the dashboard.
- **No direct sales** — PARTIAL. Good: there is no Add-to-Cart anywhere on `/oem`, no `Place order` button, no order management UI, no checkout entry point in the manufacturer header nav. Bad: a logged-in OEM can navigate manually to `/cart` and `/checkout` and the pages render. The cart is empty so they can't actually transact, but the routes are not role-blocked. Defense-in-depth fail.

## Step-by-step
1. **Login (`/login`)** — Filled #email / #password, dismissed the demo-guide overlay, submitted, redirected to `/oem`. Header gains "Manufacturer dashboard" link and shows "Morgan" (Morgan Reed, the seeded OEM user). PASS.
2. **/oem dashboard** — Branded h1 "Siemens". KPI grid renders: Listings 3, Authorized distributors 2, Units sold 0 ($0.00), Open quote requests 0. Demand-signal `AttentionFeed` is empty with the friendly "Buyer searches mentioning your brand will surface here as soon as they hit the platform." copy. "What buyers are searching for" table has 13 rows (top: `/admin` x6). "Your products on PartsPort" lists 3 SKUs with supplier name, price, and stock. "Authorized distributors" table renders. Layout is clean and on-brand.
3. **Public storefront** — None. Tested `/manufacturers` (marketing page only, no Siemens link), looked for any link out of `/oem` to a public Siemens URL. Two outbound links exist: "Manufacturer dashboard" (self) and "For manufacturers" (marketing). No `/manufacturers/siemens`, no `/brand/siemens`, no "View public storefront" button.
4. **Storefront content edit** — None. Zero "Edit" / "Customize" / "Manage storefront" affordances anywhere on `/oem`. There is no way for an OEM to upload a logo, add hero copy, or feature products. Given there is no storefront page at all, this is internally consistent but means the "A storefront you control" pillar advertised on `/manufacturers` is not actually built.
5. **No-sales-access checks (logged in as OEM):**
   - `/supplier` -> redirect to `/` (sealed)
   - `/admin` -> redirect to `/` (sealed)
   - `/ops` -> redirect to `/` (sealed)
   - `/cart` -> 200, renders "Your cart" page (allowed; cart is empty so harmless but the route is open)
   - `/checkout` -> 200, renders the Checkout page (allowed)
6. **/manufacturers public page (anon)** — Marketing/landing page with hero "A demand channel that protects the one you already built," six value tiles, onboarding timeline, fee panel ($0), and a "List your brand" application form. No directory of currently-listed brands. A visitor cannot discover that Siemens is on the platform from this page.
7. **/account as OEM** — Renders the buyer-style "My orders" panel: "Signed in as Morgan Reed · oem@partsport.example · Account settings →. You are caught up. No payments due, no quotes waiting, no shipments arriving today." Buyer copy bleeding into the OEM persona.
8. **/settings as OEM** — 200, renders. Not deeply inspected, but reachable.
9. **/catalog as OEM** — Accessible, renders normally. (Reasonable: OEMs can browse the catalog.)

## Issues found (prioritized)

### CRITICAL
1. **Demand intelligence is not scoped per OEM.** `src/app/oem/page.tsx:51` pulls the global `searchEvent` log with no `where: { ...brand/category match }`. Every manufacturer sees every other manufacturer's buyer searches. This breaks the "demand intelligence, with no channel conflict, by region and segment" promise on `/manufacturers`, and would be a non-starter for a real Siemens product manager (they'd be looking at GE/ABB/Schneider searches). Filter by `product.manufacturer === brand` joined through some category-matching heuristic, or at minimum filter for queries that contain the brand or one of its product-category keywords.
2. **There is no actual public storefront.** The whole value prop "A storefront you control" is unbacked by a route. No `/manufacturers/[slug]` or `/brand/[slug]` exists, no link from `/oem` to a public-facing page, no edit UI to populate one. This is the single biggest gap between the pitch deck and what's built.

### HIGH
3. **OEM can hit `/cart` and `/checkout`.** Both routes return 200 for a MANUFACTURER session. They cannot actually transact (empty cart, no Add-to-Cart on `/catalog` for an OEM session — needs separate test), but the pages should be role-blocked the same way `/supplier` and `/admin` are. Add MANUFACTURER to the redirect list in the cart/checkout route guard.
4. **`/account` reuses the buyer "My orders" layout for an OEM.** "Signed in as Morgan Reed" then "No payments due, no quotes waiting, no shipments arriving today" makes no sense for a manufacturer who has no purchasing relationship. Either link to `/oem` instead of rendering the buyer panel, or build an OEM-specific account view.
5. **No directory of manufacturers on `/manufacturers`.** A buyer or a prospective distributor cannot discover which brands are listed. This is a SEO + trust gap as much as a feature gap.

### POLISH
6. **`AttentionFeed` is empty.** The placeholder copy is good ("Buyer searches mentioning your brand will surface here…") but if the search log already has hits for "transformer," "circuit breaker," "protective relay," and "500 kva transformer" — all clearly Siemens categories — the feed should be lighting up. Likely the brand-matching logic in `getManufacturerAttention` is too strict.
7. **Top demand-signal row is literally `/admin`.** Even if the table is fixed to be brand-scoped, the system should sanitize obvious junk (paths, single-character queries, etc.) before showing them as "demand signal."
8. **Header for an OEM still says "For suppliers"** — odd verb tense from the OEM seat. Consider hiding it for MANUFACTURER role.
9. **No "Listings on PartsPort" detail drill-down.** The KPI says 3 listings but you can't click into a per-SKU view to see distributor-by-distributor pricing or recent quote activity. The data is in the "Your products" table below but the affordance to drill in is missing.
10. **Zero CTA to view "the public version of your storefront,"** even just a placeholder. Real OEMs will want a shareable URL.

## Console errors / Failed network requests
- Console errors: 0
- Page errors: 0
- Failed network requests: 15, all `net::ERR_ABORTED` on `_rsc=...` prefetch URLs (e.g. `/oem?_rsc=ak96a`, `/suppliers?_rsc=rrass`, `/product/MTR-RIVA?_rsc=2hegu`). These are Next.js prefetches cancelled by subsequent navigations — benign, not a bug.

## Green-flagged
- Auth flow works correctly: login routes MANUFACTURER role to `/oem`, session sticks across navigations.
- The Authorized Distributors KPI + table is the strongest part of the dashboard, with rating + SKU count and stock visible in the adjacent products table. This is the one pillar that actually delivers.
- Sales-access redirects for `/supplier`, `/admin`, `/ops` are working. The role gate is wired up, just not extended to cart/checkout.
- No console errors, no page errors, no real 5xx. The dashboard renders cleanly with real seeded data on the live URL.
- Copy throughout (KPI footers, table sub-copy, empty states) is on-brand: editorial, no em dashes, no soft-luxury filler. Matches the design system.
- The OEM dashboard reads as a coherent screen at a glance — the bones are right. The problems are that it's missing the storefront pillar entirely and that the demand-intelligence pillar leaks across tenants. Both are fixable without a redesign.
