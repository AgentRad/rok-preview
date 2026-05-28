# Fresh-eyes POV audit, all 4 roles

Branch: claude/industrial-marketplace-ROwAU. Read-only. No code changes.
Most CRITICAL/HIGH bugs already closed across P12 + PLH-1..3n. This audit
flags remaining first-10-minute friction, not regressions.

## Buyer
### CRITICAL (would prevent first order)
- None. Register, verify, search, RFQ, cart, checkout, order detail all flow cleanly.

### HIGH (would cause complaints from a real user)
- [src/app/catalog/page.tsx:356-361] Zero-result empty state says "try a different category" but never hints that AI search exists or that the buyer can open an RFQ for parts not stocked. First-time buyer searching a real SKU and getting 0 hits is the most likely abandonment point on the site.
- [src/components/CartClient.tsx:78] Empty cart copy is one bare line. No link back to catalog, no "Continue browsing", no featured-parts nudge.

### MEDIUM
- [src/app/orders/[id]/page.tsx] Messaging thread renders but with no intro line. First-time buyer does not know they can message the supplier from here. A one-line "Message the supplier about this order" above the thread would fix it.
- [src/app/account/page.tsx] No first-time nudges (save an address, set notification prefs). Account page reads like a record, not a setup surface.

### LOW
- [src/components/AddToCart.tsx:37-40] Backorder copy is technical. Warmer wording plus an inline "Request a quote instead" link would convert better.

## Supplier
### CRITICAL (would prevent first order)
- [src/app/supplier/page.tsx:49-67] Supplier user with no linked Supplier row lands on a dead-end "No supplier profile linked yet" panel. No link to apply, no status, no support route. A fresh supplier signup that does not auto-link will not know what to do.

### HIGH
- [src/components/supplier/GoLiveReadiness.tsx via /supplier dashboard] `hideWhenComplete` strips the checklist once readiness is 10/10, but nothing replaces it. A newly-live supplier sees no "You're live, taking orders now" confirmation. Should render a one-line green confirmation banner in the same slot.
- [src/app/supplier/page.tsx] AI import assistant tile is present but the dashboard does not nudge first-time suppliers toward `/supplier/catalog-import` as the recommended first action when product count is 0. CSV manual route looks like the primary path.

### MEDIUM
- [src/app/supplier/products/page.tsx] Zero-product state offers no metric ("Upload 10+ SKUs to start receiving RFQs") and no shortcut to AI import. Passive empty state.
- [src/components/supplier/AttentionPanel.tsx] "Caught up" empty state is too passive. Should point to the next growth action (add SKUs, claim a warehouse, etc.).

### LOW
- [src/app/supplier/payouts/page.tsx] Zero-payout state does not explain the 5% reserve or the payout cadence. First-time supplier expecting cash on day one will be confused.

## OEM
### CRITICAL
- [src/app/oem/page.tsx:24-51] PENDING ManufacturerApplication holding page has no expected turnaround time, no "view your application", no contact route. OEM has no way to know if the application is alive.

### HIGH
- [src/app/oem/page.tsx:53-70] User with role=MANUFACTURER but no `manufacturerName` lands on "No brand is linked yet" with no "Claim your brand" CTA. Should link directly to the application form at /manufacturers#apply (or wherever the form lives).

### MEDIUM
- OEM dashboard does not link to the OEM's own public storefront once approved. Forces the OEM to find their own page via /manufacturers list.

### LOW
- None.

## Admin
### CRITICAL
- None. Daily-ops surface is wired (applications, attention, supplier-health, audit, refunds, QBO).

### HIGH
- [src/app/admin/manufacturer-applications/page.tsx] No approval-criteria guidance on the queue. A new admin can approve/reject without a clear bar (cert? years in business? references?). One-paragraph rubric in-page would prevent inconsistent decisions.

### MEDIUM
- [src/app/admin/page.tsx] Recent orders + quotes lists are read-only with no status/supplier/date filters. Fine for a quiet day; painful once volume scales.
- [src/app/admin/supplier-health/page.tsx] Alert thresholds visible (PLH-3j P12) but no "what healthy looks like" guidance for a new admin.

### LOW
- [src/app/admin/audit/page.tsx] Newest 50 events with no filter summary. A new admin lands on noise. A "today's notable events" header would help.

## Cross-cutting issues
- Application/approval flows (buyer verify, supplier app, OEM brand claim) all have holding pages but none surface timeline, status, or escalation. Same fix pattern across all three.
- Empty states are technically honest but uniformly passive. Each one should answer "what is the next action?" with one specific link.
- New-feature discovery: AI import, AI search, messaging threads, address book all exist but are not surfaced as "try this first" on initial entry.
- No success celebration after material milestones (supplier goes live, OEM approved, buyer first order). PLH-3l hides the checklist on go-live but does not say "you are live."

## Recommendation

### Round 1: Onboarding status + transparency (closes 1 CRITICAL Supplier + 1 CRITICAL OEM + 1 HIGH OEM)
- /supplier dashboard: when no Supplier row linked, render a "Apply to sell" CTA pointing at the supplier application route. Show a "We aim to review within 2 business days" timeline on the PENDING state.
- /oem dashboard: PENDING ManufacturerApplication state gets timeline + "view application" link. NO brand claim state gets a direct "Claim your brand" button to the application form.
- Supplier dashboard: when readiness ready + publicVisible, render a one-line green "You are live, accepting orders" banner in the slot vacated by GoLiveReadiness.

### Round 2: Empty-state nudges (closes 2 HIGH Buyer + 1 HIGH Supplier)
- Catalog zero-results: add "Open an RFQ for this part" CTA next to the existing "try a different category" copy. Hint at AI search when the keyword looks like an SKU.
- CartClient empty state: add explicit "Browse catalog" link inline.
- /supplier dashboard: when product count = 0, hoist the AI import tile above CatalogEditor with "Upload your first catalog in 5 minutes" copy.

### Round 3: First-time feature surfacing (closes 1 HIGH Admin + buyer/supplier MEDIUMs)
- /orders/[id]: add "Message the supplier about this order" one-liner above the thread.
- /admin/manufacturer-applications: add one-paragraph rubric card at the top of the queue (criteria, examples of approve vs reject).
- /admin: add a "Today's urgent" card above the order/quote lists (pending refunds, overdue RFQs, suspended suppliers).

All three rounds are copy + layout only. No schema, no API, no migration.
