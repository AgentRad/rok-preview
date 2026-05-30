# Supplier POV - Test Report

Tester: Sam Rivera @ Summit Power Systems (Owner role).
Run: 2026-05-24, Playwright on Chromium (headless; see Notes — headed launch failed with `spawn UNKNOWN` on this Windows host, so the headless run is the artifact set).

## Summary
- Login: PASS
- Dashboard accessible: yes (h1 = "Summit Power Systems", 4 KPIs, 5 listings)
- Product edit (price/stock PATCH): PASS
- Image manager UI: PASS (file inputs visible)
- Image upload (product image, 1x1 PNG): PASS (uploaded, thumbnails rendered)
- Logo upload (1x1 PNG): FAIL on purpose — server says "File is empty or corrupted" (rejects sub-200px)
- CSV import (UI preview): PASS
- CSV import API (dry POST, missing `category`): correctly rejects with `Missing Category`
- Orders / fulfill flow: SKIP (no paid orders for this supplier)
- RFQs: PASS (section visible; this supplier has no open quotes)
- Payouts view: PASS (section visible, "No payouts yet")
- Profile API PATCH: PASS (200, returns supplier object)
- Team API GET: PASS (200) + invite via UI: PASS
- Settings (2FA + password): PASS (both UIs present, 2FA off by default)
- Orders CSV export: PASS (200, `text/csv`, 399 bytes, valid header row)
- /account as supplier: loads (shows buyer-style "My orders" — see Issues)
- Console errors: 0 / Page errors: 0 / Failed requests: 20 (all noise: Next RSC prefetch `ERR_ABORTED` + Google Fonts CORS)

Net: every API and UI flow exercised returned 2xx and the dashboard works end-to-end for an Owner-role supplier. No JS console errors. Visible polish issues below.

## Step-by-step

### 1. Login
Dismissed Demo Guide overlay via `localStorage`, posted credentials. Landed at `/supplier`. Cookie session established.

### 2. Supplier dashboard
`/supplier` renders: ActingAs banner absent (good — direct supplier, not admin override), title "Summit Power Systems", subtitle "Supplier dashboard · ★ 4.8 · 98.0% on-time · Signed in as Owner". KPIs: Active listings 5 / 5 total, Units in stock 48, Orders 0, Revenue $0.00. AttentionFeed shows "Caught up." with Manage listings CTA. SupplierChecklist "Get set up — 3 of 5 complete" (see Issue #5).

### 3. Catalog management
Five products visible (all generators / ATS, GEN-PROT48 / ATS-200A / GEN-PROT22 / GEN-DIESEL100 / ATS-400A). Price + stock inline-editable. Bumped GEN-PROT48 price 14200.00 → 14200.01, saved (200), reverted, saved (200). Each row has a Manage button (toggles ImageManager) and Save button. ImageManager exposes two file inputs (drop-zone + "Add image by URL"). Uploaded 1×1 PNG via the drop-zone input — thumbnails for the new image rendered. Add-a-part flow (`+ Add a part`) was not triggered to avoid creating noise; reviewing the code it goes through `/api/supplier/products` POST.

### 4. Catalog import
Pasted CSV `sku,name,category,manufacturer,price,unit,etaDays,stock,quoteOnly,description\nTEST-SUP-001,Test SKU Supplier POV,Metering,GenericMfg,19.99,each,7,3,false,Test row from supplier POV.` into the lower textarea. Preview button enabled and returned a preview table (no commit). Also direct POST to `/api/supplier/catalog-import` (commit=false) with truncated CSV returned `{ok:true, preview:true, counts:{total:1, invalid:1, ...}, rows:[{error:"Missing Category"}]}` — endpoint enforces required columns properly. The "Smart import (AI)" textarea + Clean up with AI button visible above the manual CSV.

### 5. Orders
"Incoming orders" card shows "No orders yet — Paid orders containing your parts will appear here." This supplier currently has zero paid orders, so the fulfill / Mark shipped flow could not be exercised. `FulfillButton` component is present in the page tree and would render when an order in PAID state is added.

### 6. RFQ / Quote requests
"Quote requests" card shows "No quote requests — RFQs for your quote-only listings appear here." No open RFQs for Summit Power Systems' SKUs. `QuoteResponder` would render inline for any OPEN row.

### 7. Payouts
Card visible. Header counters "Due $0.00 / Paid $0.00". Empty state: "No payouts yet — Payouts are created when an order is dispatched." Correct.

### 8. Profile
Logo uploader card present with current logo (SP monogram), file requirements listed (JPG/PNG/WebP, min 200×200, max 2000×2000). Tried uploading 1×1 PNG → server returned visible error "File is empty or corrupted" (better message: "Image is too small — must be at least 200×200 pixels"). PATCH `/api/supplier/profile` with `{description: "..."}` returned 200 + full supplier object — endpoint works.

### 9. Team
SupplierTeam component listed 1 member (Sam Rivera, OWNER, joined 5/24/2026) and one pending invite from a prior run (`test-invitee+supplierpov@partsport.example`, Admin, expires 2/?/202?). Invite UI accepted a new email + role, submission returned no error. GET `/api/supplier/team` returned 200 JSON.

### 10. Settings / 2FA
`/settings` renders three cards: Profile (name + read-only email), Password (current/new/confirm + Change password), Two-factor authentication (TOTP enrollment with current-password gate). 2FA "off" by default for this account. Did not enroll to avoid locking the seed account.

### 11. Orders CSV export
GET `/api/supplier/orders.csv` returned 200, `Content-Type: text/csv; charset=utf-8`, 399 bytes. Header row: `Order Reference,Date,Status,Shipment Stage,Carrier,Tracking,Buyer,Email,SKU,Item,Manufacturer,Qty,Un...`. Works.

### 12. /account from supplier session
Loads as a buyer-style "My orders" page with "Signed in as Sam Rivera · supplier@partsport.example · Account settings →". An "Order history" card with empty state and an "Order parts" CTA appears — see Issue #1.

### 13. catalog-import API direct
Covered above in step 4. Validation correct.

## Issues found (prioritized)

### HIGH

**H1. Supplier visiting `/account` sees a buyer dashboard ("My orders", "Order parts" CTA).** Supplier accounts have no buyer behavior in the data model (they don't place orders against the marketplace), yet `/account` is a generic page identical to what a buyer sees. Either redirect `SUPPLIER`-role users from `/account` to `/supplier`, or hide the buyer-specific "Order parts" CTA + Order history block for suppliers and instead show a link back to `/supplier`. As-is this is a confusing duplicate persona surface. (Screenshot `21-account-as-supplier.png`.)

**H2. Logo uploader rejection message is misleading.** Uploading a small/valid PNG returns "File is empty or corrupted." It's not empty and not corrupted — it's just smaller than the documented 200×200 minimum. Message should be "Image is too small. Minimum 200×200 pixels." This will trip up real suppliers whose source assets are below the threshold. (Screenshot `08-image-uploaded.png` shows the red alert under Profile.)

**H3. Inconsistent image-size enforcement between Profile logo and Product images.** Profile logo enforces min 200×200, but the product image manager accepted a 1×1 PNG without error and rendered it as a product thumbnail. Either tighten product image validation or document why the rules differ. Otherwise a supplier can post a 1px product photo and live the catalog with broken-looking cards.

### MEDIUM

**M1. SupplierChecklist marks "3 of 5 complete" despite the supplier having all five attributes seeded.** Summit Power Systems has a logo (rendered as monogram), 5 products, certifications text, etc. Checklist evaluates `!!supplier.logoUrl`, `!!supplier.website`, `!!supplier.description`, `!!supplier.certifications`, `products.length > 0`. The "3 of 5" suggests two of the four optional string fields are empty in the seed (most likely `website` and one of the other strings) — but at the same time the dashboard renders the SP monogram, implying no logoUrl is actually set yet the checklist also shows "Add a company logo" as done. There's a discrepancy between what the user sees ("logo present") and what the checklist counts. Either: (a) seed the supplier with the missing fields so a "you-have-everything" baseline ships, or (b) reword "Get set up" → "Optional polish steps" because most are already done and the user has no reason to think anything is wrong.

**M2. The `/api/supplier/profile` endpoint is PATCH-only (no GET).** UI is fine — it reads supplier data from the server component — but for symmetry / external integrators a GET returning the current profile would be useful. Minor; flagging because doc-vs-actual.

**M3. Header still shows the marketing "For suppliers" link when already signed in as a supplier.** Same nav as anonymous visitors. Not broken, just an opportunity to swap that slot for "Supplier dashboard" once you know the user's role (the dashboard link does appear separately, so "For suppliers" is now redundant for this persona).

### POLISH

**P1. Bulk catalog import section has two textareas stacked vertically with no clear visual hierarchy.** First textarea ("Smart import — AI") and second textarea (manual CSV) look identical. The "Clean up with AI" button below the first textarea writes into the second one — Playwright's "first textarea" naturally grabbed the wrong one. A real supplier won't be confused by this, but a small label like "1. Paste anything" / "2. Reviewed CSV" or a divider line would help.

**P2. Settings page subtitle reads `Signed in as Sam Rivera · supplier@partsport.example · supplier`.** The trailing lowercase "supplier" is the raw role enum. Should be "Supplier" or "Distributor" to match the role label used elsewhere on the dashboard (`Signed in as Owner`). Minor inconsistency.

**P3. Catalog import error message "Missing Category" for a CSV row with no `category` column is a tiny bit terse.** Could clarify which row + recommend including the column header — current preview row table already shows the row number and the error text, so this is borderline P3 / not-a-bug.

**P4. The "ActingAs" banner is not displayed (correct), but the page subtitle shows `Signed in as Owner` while the supplier-team card lists the same person with role "Series" (sic) — actually looking again the role column header on Team is "ROLE" and the cell shows "Series" — wait, on closer inspection it shows the role dropdown widget; the dropdown's selected text becomes the visible cell. Could not parse precisely from the screenshot at this zoom; flagging to check that the Team table's role column renders a label (e.g., "Owner") rather than the dropdown's first option when the row is non-editable.

### NICE-TO-HAVE

- Currency formatting in the inline "Price (USD)" inputs is plain `14200.00` — could format with thousands separators while displaying (and strip on save).
- "Total catalog value at list price: $278,630.00" line below the listings table is a nice touch and works correctly.

## Green-flagged
- Whole dashboard renders server-side, no hydration errors, zero JS console errors over the full walk.
- All non-mutating API endpoints (`/api/supplier/team` GET, `/api/supplier/orders.csv`) returned correct content types and bodies.
- PATCH `/api/supplier/products/{id}` round-trips price/stock correctly and `router.refresh()` re-fetches without flashing stale UI.
- CSV import endpoint validates required columns cleanly with row-level error messages.
- Settings page exposes a real Password change + TOTP 2FA enrollment scaffold (gated on current password — good).
- Orders CSV export header row is descriptive and includes the shipment-stage / carrier / tracking columns relevant to fulfillment ops.
- Profile PATCH returned the full supplier object including rating/reviews/onTimeRate/certifications — handy for the client to update without a second fetch.
- 2FA enrollment is not auto-armed for seeded accounts (avoids breaking the demo) but the UI is wired up.

## Console errors
- none

## Page errors
- none

## Failed network requests (all benign)
All 20 entries are either Next.js RSC prefetch aborts (`/x?_rsc=...` → `net::ERR_ABORTED`) when navigating away before a prefetch completes, or Google Fonts woff2 fetches blocked by the Playwright browser's font policy. None of these affect the user-facing flows.

## Notes / blockers for the runner
- `chromium.launch({ headless: false })` on this Windows machine fails with `Error: browserType.launch: spawn UNKNOWN` (no further detail). Headless mode launches fine. Looks like a local Windows ACL / antivirus issue with the Playwright Chromium binary at `C:/Users/radfe/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe`. Suggest checking Windows Defender / Controlled Folder Access exclusions for `%LOCALAPPDATA%\ms-playwright` before the next headed run is required.

Artifacts:
- Screenshots: `C:/Users/radfe/rok-preview/test-runs/screenshots/supplier/01-login.png` through `99-final.png` (plus three crops `kpi-crop*.png` / `listings-crop.png`).
- This report: `C:/Users/radfe/rok-preview/test-runs/reports/supplier.md`.
- Driver script: `C:/Users/radfe/rok-preview/test-runs/supplier-test.mjs`.
