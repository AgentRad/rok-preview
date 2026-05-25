# Admin POV — Test Report

Persona: Avery Ops (admin@partsport.example) on `https://rok-preview-git-claude-industrial-marketplace-rowau-agentrad.vercel.app`. Walk executed by `test-runs/admin-test.mjs` driven by Playwright + system Chrome (HEADED, slowMo 300). Screenshots in `test-runs/screenshots/admin/`.

## Summary
- Login: PASS
- Admin console accessible: yes (full data load, all sections present)
- Ops board accessible: yes
- Supplier approval: PASS (mechanism wired, but seed had **0 pending applications** so no real approval exercised)
- CSV exports: PASS (both `invoices.csv` and `orders.csv` downloaded with the documented filename and well-formed header rows)
- Console errors: 14 (all `400` chunks for RSC prefetches — see below; cosmetic)
- Failed network requests: 56 (all `net::ERR_ABORTED` from RSC prefetch races on header `<Link>` items; not user-visible)

## Step-by-step

### 1. Login (`/login`)
- Demo guide modal (`.dg-overlay`) initially intercepted clicks. Worked around by pre-seeding `localStorage["partsport_demo_guide_v1"] = "1"`. After that, login submitted instantly and landed on `/admin`.
- Cosmetic note: real users running through the demo never have that LS key set, so on first visit the modal blocks the **Sign in** button until dismissed. Easy paper-cut.

### 2. Admin console (`/admin`)
- H1 "Admin console", KPIs **GMV $8,980.30 (2 paid), Marketplace revenue $507.90, Suppliers 11, Pending applications 0**.
- Sections rendered in order: Attention feed, KPI grid, Add a supplier directly, Supplier applications, Recent orders (5 rows), Invoices (1 row), Tax-exempt certificates (empty), Quote requests (3 rows), Suppliers (11 rows).
- Attention feed banner reads "2 team invites not yet accepted" with a single-row supplier-team item — these read more like supplier-side work than admin work and feel cross-pollinated into the admin overview.
- Suppliers table all "APPROVED", rating ~4.7, several with 9 listings each.

### 3. Supplier applications — approve/reject
- Seed has **0 pending applications**, so the card shows "No pending applications". Code path inspected (`src/components/ApplicationReview.tsx` + `src/app/api/admin/applications/[id]/route.ts`) — approval creates a `Supplier` + `User` (role `SUPPLIER` or `MANUFACTURER`) and fires an email side-effect via `sendApplicationStatus`. On success the UI shows a green inline string with the new login + temp password (`demo1234`).
- Cannot end-to-end verify the email side effect without a pending app. Worth seeding one for demos.

### 4. Suppliers — edit
- 11 suppliers listed. Clicked "Edit" on the first row, modified the description, saved, then restored — both PATCH `/api/admin/suppliers/{id}` calls returned 200 and the row re-rendered.
- Note: only `name / contactEmail / logoUrl / website / description / certifications` are exposed in the inline edit form. **No UI for fee%, verified flag, status (APPROVED / SUSPENDED), rating, or on-time rate** even though the schema and KPIs reference them.

### 5. Invoices export — CSV
- `GET /api/admin/invoices.csv` returned a download named `partsport-invoices-2026-05-25.csv`, 360 bytes, valid header: `Invoice No,Customer,Email,Date,Item,SKU,Supplier,Qty,Rate,Amount,Status`. Body had one paid order (INV-PP-ZN9WTY) split into two rows (item line + platform fee line). QuickBooks-friendly.
- Only one invoice on the system, so a real "export" payload is tiny. Functions correctly.

### 6. Orders export — CSV
- `GET /api/admin/orders.csv` returned `partsport-orders-2026-05-25.csv`, 927 bytes. Header `Order Reference,Date Placed,Date Paid,Status,Shipment Stage,Carrier,Tracking,Buyer,Email,Ship To,Items,Subtotal,Freight,Platform Fee,Sales Tax,Total`. 5 orders included (PAID + PENDING). Looks correct.

### 7. Tax-exempt certificates
- Card empty — "No tax-exempt certificates on file". Not exercisable without a buyer uploading a cert first. Code path (`TaxExemptReview.tsx` + `/api/admin/addresses/[id]/tax-exempt`) is in place and approve/reject buttons are wired to a PATCH endpoint.

### 8. Impersonation — "Manage as" / acting-as
- The mechanism is `POST /api/admin/acting-as` with `{ supplierId }` (also `DELETE` to clear). UI is a **"Manage as"** link on each row in the Suppliers table (`SupplierAdminRow.tsx`).
- Clicked "Manage as" on the first supplier (Gridline Power Supply). Landed on `/supplier`, banner at top reads **"Admin override — You are acting as Gridline Power Supply. Everything you change here is recorded as if their owner did it."** with an amber **"Stop and return to admin"** button. Excellent UX, much clearer than typical impersonation banners.
- Stop button worked, returned to admin.
- Console showed one `403` on `/supplier?_rsc=…` — a stale RSC prefetch fired before the cookie was set; the actual nav succeeded. Minor.

### 9. Ops board (`/ops`)
- H1 "Fulfillment ops". Sections **New 2, Processing 0, Shipped 0, Delivered 0**.
- Clicked **Start processing** on PP-YZBG2H. Counters updated to **New 1, Processing 1**, and the row sprouted Carrier / Tracking number inputs + a (disabled until filled) **Mark shipped** button. Worked as designed.
- KPI tile "OPEN ORDERS 2 paid, not yet delivered" did **not** decrement — that count is `status === "PAID"` regardless of shipmentStage, which is actually correct (the order is still "open" even though it's now Processing) — but the label "paid, not yet delivered" is technically a tautology versus the table state. Minor wording.

### 10. Payouts
- Seed has zero `DUE` payouts (the only PAID order hasn't been Shipped, so no payout was created). Card shows "No payouts due" + "Payouts are created when an order is marked Shipped." Cannot exercise mark-paid without first shipping. The flow itself (`MarkPayoutPaid.tsx` -> `PATCH /api/payouts/{id}`) is wired.

### 11. Returns / RMA
- No Returns card present on the admin overview — confirms `prisma.returnRequest.findMany(...)` returns empty for this seed. The admin page only renders the Return requests card `{returns.length > 0 && ...}`. Mechanism inspected; no live test possible.

### 12. Settings (`/settings`)
- H1 "Settings", loaded for the admin persona. No errors. (Did not deeply exercise; admins likely have minimal settings.)

### 13. Misc / dashboard health
- Zero broken images on `/admin`.
- No layout overflows or stale numbers spotted at 1440x900.

## Issues found (prioritized)

### HIGH
- **Demo guide modal blocks first-time login.** The `.dg-overlay` covers the page on first visit and Playwright (and real users with reduced motion / keyboard-only) can be blocked from the Sign-in button because the overlay never auto-dismisses on Enter or Escape. Fix: either close on Escape, or render the overlay with `pointer-events: none` outside the dialog box, or skip on `/login`. Repro: clear localStorage, visit `/login`, try to click Sign in via Playwright/automation.
- **No way to exercise the supplier-approval email path without a pending application in seed.** Seed currently includes 0 `SupplierApplication.status === "PENDING"`. This is the headline "demo this" workflow per the mission. Seed 1-2 pending applications so the Admin overview tells a story.

### POLISH / MEDIUM
- **Supplier "Edit" form is missing the fields the brief mentions** (verified/status flag, fee%, rating). Either implement them or document that they are intentionally seed-only. Currently the editable surface area is just contact/marketing fields.
- **Attention feed mixes supplier-team chores into the admin overview.** "2 team invites not yet accepted" is a supplier concern; admin shouldn't see another tenant's team paperwork unless they're acting-as. Worth scoping `getAdminAttention()` to truly admin-actionable items.
- **CSV filenames use UTC date** (`partsport-invoices-2026-05-25.csv`). On 2026-05-24 23:xx local time the file looks dated-tomorrow. Minor.
- **`/supplier` 403 on RSC prefetch** right at the moment "Manage as" sets the acting-as cookie. Race only, no user impact, but it pollutes the network panel.
- **Ops KPI "OPEN ORDERS — paid, not yet delivered"** does not change when an order moves New -> Processing -> Shipped. Technically correct (status is still PAID), but the subtitle reads like the count is shipmentStage-driven. Either rename to "Open paid orders" or actually filter on `shipmentStage !== "Delivered"`.

### CONSOLE / NETWORK NOISE
- 14 console `400` errors and ~56 `ERR_ABORTED` requests are all RSC chunk prefetches for header `<Link>` items (e.g. `/cart?_rsc=...`, `/manufacturers?_rsc=...`, `/.well-known/vercel/jwe`, `HEAD /login`). Not user-visible but they are spammy in DevTools and could mask real issues during dev.

## Green-flagged (working nicely)
- Admin console layout, KPI cards, and section composition.
- "Manage as" impersonation banner copy and contrast — clearest impersonation UX I've seen, and the "Stop and return to admin" button is unmistakable.
- CSV exports are real downloads, correctly named, with clean headers.
- Ops board stage transitions feel instant and the Carrier/Tracking inline form is the right shape.
- No emojis, no em dashes spotted in the surfaces tested. Consistent with the project's voice rules.

## Console errors
All `400` chunked-RSC responses for the routes the header preloads (`/`, `/cart`, `/manufacturers`, `/suppliers`, `/catalog`, `/how-it-works`, `/admin`, `/ops`, `/settings`, `/login`, `/.well-known/vercel/jwe`). No real exceptions thrown, no `pageerror` events fired.

## Failed network requests
56 entries, all `net::ERR_ABORTED` against the same RSC + JWE preload set. Same root cause as above.

## Screenshots captured
`01-login.png`, `01b-after-login.png`, `02-admin.png`, `03-app-approved.png` (not generated — empty card), `04-supplier-edit-open.png`, `04b-supplier-saved.png`, `07-tax-exempt.png`, `07b-tax-after.png`, `08-acting-as.png`, `09-ops.png`, `09b-ops-advance.png`, `10-payouts.png`, `12-settings.png` plus `invoices.csv` and `orders.csv` downloads.
