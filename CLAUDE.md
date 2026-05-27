# PartsPort, project context

Working brief for anyone (human or AI) continuing this project. Read this first.

## What it is
A full-stack online marketplace for **energy & utilities equipment**: transformers,
switchgear, protective relays, conductors, metering, generators, solar, storage,
grounding, SCADA. Buyers search or describe what they need, compare vetted-supplier
options, and order. PartsPort takes a small transaction fee and handles payment and
delivery.

## Business model (decided, do not re-litigate)
- Three parties: **manufacturers (OEMs)** build equipment, **distributors** stock and
  sell it, **buyers** (utilities, co-ops, contractors, EPCs) need it.
- **OEMs participate free** (storefront plus demand visibility, no channel conflict;
  every sale routes to their authorized distributors).
- **Distributors pay the transaction fee** (6%) on orders that settle on-platform.
- **Two purchasing lanes:** instant checkout for in-stock items; an **RFQ / "Request a
  quote"** flow for big-ticket configured equipment (>= $3,000). The accepted quote
  becomes an on-platform order so the transaction/fee always settles here.
- Energy & utilities is the **starting vertical**; the catalog is category-agnostic and
  meant to expand to other industries later.

## Status (updated 2026-05-26, post PLH-2)
The app is **deployed, ship-ready, and feature-complete for soft launch**.
All pre-launch polish rounds P6 through P11.10 are shipped and verified.
Final PageSpeed Mobile: **Performance 92 / Accessibility 100 / Best Practices 100 / SEO 100**.
First Load JS shared = 102 kB. Bundle is in the top 10% of B2B sites.

What shipped (in order):
- **P6** Supplier onboarding (legal docs + bank + Stripe Connect + 10-item go-live gate)
- **P7** Trust + legal (email verify, password reset, audit log, Sentry, Upstash rate
  limit, 5 legal pages, cookie consent)
- **P8** Money ops (Stripe Connect Express payouts, 5% chargeback reserve, refund
  flow, 4 daily crons, profit dashboard, tax registrations)
- **P9** Real freight (Shippo integration, SupplierWarehouse, dimensions,
  multi-supplier split, surcharges, label printing)
- **P9.5** Audit fixes (CRON_SECRET fail-closed, server-trusted freight pricing,
  order idempotency, refund clawback netting via `owedToPlatformCents`, webhook
  idempotency, manufacturers public-filter, email-verify gates, audit-log gap fills)
- **P9.6** HIGH fix (idempotency lookup before rate-limit on POST /api/orders)
- **P10** SEO (per-page metadata, Open Graph, Twitter cards, canonical URLs, JSON-LD,
  sitemap, robots, structured data)
- **P11** Analytics + a11y + mobile UX + LCP (next/font self-hosted, Vercel Analytics,
  dynamic chrome, Sentry trim, route-scoped CSS splitting, mobile filter toggle,
  type scale, 100s of UI fixes)
- **P11.5 through P11.10** Iterative audit + verify rounds. P11.7 alone closed 32 of
  37 catalog UI flaws across 5 CRITICALs, 12 HIGHs, 13 MEDIUMs, 7 LOWs. P11.10
  removed `@sentry/nextjs` from client bundle (-77 KB), split globals.css per route,
  trimmed Hanken to non-italic only, quality-65 transcodes.

**P12 (2026-05-26)**: Pre-launch audit fixes (real bugs, not polish). 5 sequential
commits landed all CRIT + HIGH + MEDIUM items from the audit round:
- Commit 1 (C1+C2): RFQ /accept now requires owner session or guest email match
  (rate-limited 5/hour/IP) and no longer creates an Order with freight=0 / tax=0 /
  shipTo="To be confirmed". Accept marks the quote ACCEPTED and routes to a new
  /checkout-from-quote/[id] bridge page that collects ship-to, computes
  server-trusted Shippo freight, creates a PENDING Order with locked unit price,
  then hands off to Stripe Checkout where Stripe Tax computes the real tax.
- Commit 2 (C3): money leak fix in lib/payouts.ts. Old ordering decremented
  Supplier.owedToPlatformCents BEFORE the Stripe transfer; failure wiped the
  debt without recovering cash. New 3-stage flow: Stage 1 creates Payout with
  planned recovery stashed on note, Stage 2 fires transfer, Stage 3a settles
  with fresh re-read + Math.min on success, Stage 3b leaves owed alone on
  failure. payout-retry cron uses the same settlePayoutSuccess primitive and
  re-derives planned recovery against current owed at retry time.
- Commit 3 (H1..H8): QuoteRequest.quoteExpiresAt (30-day default at price time,
  410 on accept past expiry), unique filtered index on QuoteRequest.orderId
  with $transaction-wrapped create-order + update-quote and P2002-idempotent
  fallback, email-verify gate on /accept for signed-in users, return-PATCH
  approve now requires amountCents + routes through refundOrder, four return
  emails (approved/rejected/resolved/notify-supplier), 409 on duplicate OPEN
  returns, and Postgres CHECK constraints supplier_owed_nonneg +
  supplier_reserve_nonneg as the belt for the suspenders.
- Commit 4 (M3..M12, L4): quote lifecycle audit-logged (QUOTE_SUBMITTED,
  QUOTE_PRICED, QUOTE_DECLINED, QUOTE_ACCEPTED, plus QUOTE_EXPIRED reserved
  for the lazy-detect path), sendQuoteDeclined email, OPEN-quote dedupe on
  (productId, buyerEmail), refunds.ts per-supplier clawback loop wrapped in
  $transaction with fresh re-read, OWED_INCURRED reserve-transaction type for
  shortfalls (so DRAW_DOWN keeps its narrow meaning), supplier dashboard
  Reserve & balance card (reserve held + owed + 10 most recent transactions).
- Commit 5: QuickBooks Online "Import Customers and Invoices" CSV at
  /api/admin/invoices-quickbooks.csv (PAID invoices only, QBO column ordering),
  /admin/supplier-health page with per-supplier metrics (stock, avg
  days-to-ship 30d, order volume 30/90/YTD, refund rate 90d, reserve, owed,
  last activity) and alerts (refund > 5%, days-to-ship > 7, owed > 0,
  inactive > 30d). Linked from the admin top nav.

Migration: prisma/migrations/20260601120000_p12_quote_expiry_and_constraints
adds QuoteRequest.quoteExpiresAt + unique orderId index + the two CHECK
constraints.

**PLH-1 (2026-05-26)**: Pre-launch hardening audit. 5 sequential commits
closed the remaining 16 CRITICAL plus relevant HIGH bugs across Auth/Account,
Supplier Onboarding, and Multi-Supplier Orders.
- Commit 1: server-side session invalidation (User.sessionsValidFrom + svf
  JWT claim, bumped on password reset/change, 2FA disable, email change
  confirm, account self-delete). Password floor 8 cap 128. SESSION_SECRET
  refuses < 32 chars in production. Email verify token hashed at rest.
- Commit 2: auth UX + enumeration suppression (HTML-escape email bodies,
  normalize name/email, suppress register and login enumeration, register
  no longer auto-signs-in, session-fixation interstitial on three GET
  state-mutators, account delete blocked on open orders, anonymize cron,
  unverified cleanup cron, broad rate-limit coverage).
- Commit 3: supplier onboarding security. Approval flow no longer mints
  "demo1234" temp passwords; new suppliers get a reset-token link via the
  same path as forgot-password. Server-side go-live gate. SupplierDocument
  blobs uploaded private with download routes behind canManageDocuments
  and an audit row per fetch. Magic-byte MIME detection on document and
  logo uploads. URL-paste branch removed. Suspended suppliers can no
  longer accept new orders or RFQs. SVG removed from logo allow-list.
- Commit 4: supplier onboarding UX + rate limits. /api/applications POST
  rate-limited + soft idempotency on (email + companyName + PENDING + 24h).
  rateLimit("generic", supplier:<userId>) on supplier mutating endpoints.
  Bank-info PATCH writes a diff audit row + admin attention card.
  sendSupplierDocReviewed email. New /api/cron/connect-sync auto-flips
  publicVisible false on a Stripe Connect payouts-enabled true to false
  transition.
- Commit 5: multi-supplier orders + webhook clawback. Single-supplier cart
  constraint enforced client-side (DifferentSupplierError + modal in
  AddToCart and QuickAddButton, banner in CartClient) and server-side
  (/api/orders POST rejects mixed-supplier carts 400). charge.refunded
  webhook now calls applySupplierClawback so out-of-band Stripe-dashboard
  refunds move reserveBalanceCents and owedToPlatformCents the same way
  admin-initiated refunds do. Clawback extracted from refunds.ts into a
  shared primitive, called from both refundOrder() and the webhook.

**PLH-2 (2026-05-26)**. Final pre-launch round. Two new features plus a
five-area audit. Closes the loop on post-purchase comms and supplier
self-service, and hardens five surfaces that had not been audited at the
same depth as auth / payments / RFQ.

New features shipped:
- **Phase 1: inbound email threading activation.** `/api/email/inbound`
  with provider switches (resend / postmark / sendgrid). Per-thread
  Reply-To addresses signed with HMAC-SHA256 over `${kind}.${id}` in
  `src/lib/inbound-email.ts`. Constant-time signature compare, sender
  matched to a known user, thread membership re-checked (buyer / admin /
  supplier-with-canSendMessages), quoted-history stripped, body capped
  at 4 KB stored, fan-out via Next.js `after()` so the lambda stays alive
  on Vercel. Fail-closed 404 when `INBOUND_EMAIL_PROVIDER` unset.
- **Phase 2: supplier AI assistant** at `/api/supplier/ai-assistant`.
  Streams Claude Sonnet 4.6 SSE-style responses grounded in the calling
  supplier's own data (30-day orders, top SKUs, payouts, refunds 90d,
  inventory, reserve and owed balances). Auth via `getActiveSupplierContext`,
  rate-limited via the new `ai-assistant` bucket at 30/hour/supplier,
  question capped at 2000 chars, system prompt cache-controlled,
  question hash + token usage written to AuditLog. 503 when
  `ANTHROPIC_API_KEY` unset.

Phase 4 audit (5 sequential commits) closed 7 CRITICAL + 12 HIGH across
five surfaces:
- **4a CSV import** (A1..A6): batched `$transaction` writes with rollback,
  compound `where { sku, supplierId }` for SKU ownership, BOM strip in
  parseCsv, `csvSafeCell` formula-injection guard across all 5 CSV export
  routes, 2 MB body cap, rate limit on import + cleanup.
- **4b AI search** (B1..B2): query length cap 200, rate-limit
  `ai-search` 20/hour/IP on the catalog RSC, in-memory LRU cache
  (sha256-keyed, 30 min TTL, 500 entries), catalog passed to the prompt
  capped at 500 rows with heuristic prefilter above that.
- **4c OEM storefront** (C1..C4): `detectMagic` + `safeExt` on logo
  upload, SVG dropped from logo allow-list (kills storefront XSS),
  rate limits on `/api/oem/profile` + logo, strict URL parse +
  http(s)-only protocol + 200-char cap on `manufacturerWebsite`.
- **4d address book + notif prefs** (D1..D4): per-user
  `notifyOrderEmails` / `notifyMarketingEmails` / `notifyProductUpdates`
  flags with `shouldSendToUser` gate + Settings card + RFC 8058
  List-Unsubscribe header + signed-token public unsubscribe route,
  rate limits across all `/api/addresses/*` mutators, per-field length
  caps with structured `{ field, error }` 400s, ISO alpha-2 country
  regex + per-country postal regex, tax-exempt blob flipped to
  `access:"private"` with audited download route + magic-byte MIME
  sniff (PDF/JPEG/PNG only).
- **4e crons** (E1..E5): auto-deliver routed through
  `isAuthorizedCronRequest`, no-longer-swallowed email failures with
  new `AUTO_DELIVER_EMAIL_FAILED` audit + `Order.deliveryEmailSentAt`,
  reserve-release 3-stage flow with PENDING/COMPLETED/FAILED status
  on `SupplierReserveTransaction` plus stage-3 re-read + Math.min,
  `MAX_PER_RUN=200` cap on auto-deliver and reserve-release with
  ASC ordering and `hasMore`, `ReconciliationState` singleton cursor
  walking forward in 7-day windows.

Migrations: `20260603000000_plh2_phase4d_notif_prefs`,
`20260604000000_plh2_phase4e_cron_audit`.

Auth flows + RFQ + returns + multi-supplier + refund clawback are now
all hardened across P12 + PLH-1 + PLH-2. Remaining items are MEDIUM/LOW
polish queued post-launch in `docs/ORCHESTRATOR.md`.

**PLH-3a (2026-05-26).** Supplier-health dashboard fixes from a
post-PLH-2 admin daily-use audit. 2 commits.
- B1: `Order.shippedAt DateTime?` column + idempotent stamp inside the
  shared `markOrderShipped()` helper. Migration includes a `paidAt + 1
  day` backfill estimate for historical Shipped/Delivered orders so the
  metric has data on day one. Supplier-health page now subtracts
  `shippedAt - paidAt` (was previously `createdAt - paidAt`, sign
  inverted, clamped every result to 0). The "avg days-to-ship > 7" alert
  can actually fire now.
- B2: bounded the unbounded `orderItem.findMany` on the supplier-health
  page with a `where: { order: { createdAt: { gte: YTD_START } } }`
  filter. Page is no longer O(all order items in DB).
Migration: `20260605000000_add_order_shipped_at`.

**PLH-3b (2026-05-26).** Messaging + inbound email threading audit. 8
commits, 6 HIGH + 1 MEDIUM closed.
- F0: removed the duplicate `remotion/` folder from the rok-preview
  tree (video work lives at `C:\Users\radfe\partsport-videos`) and
  reverted the tsconfig exclude band-aid.
- F1: `sendThreadMessage(recipientUserId)` now respects PLH-2 4d's
  `notifyOrderEmails` opt-out via `shouldSendToUser`. Four callers
  updated (UI POST, inbound order, inbound quote, bounce-back).
- F2: `Message.inboundFingerprint` unique index. Inbound dedup via
  Prisma P2002 short-circuit. UI posts keep fingerprint null so the
  dedup is inbound-only.
- F3: inbound now rejects replies to terminal-status orders
  (REFUNDED/CANCELLED) and quotes (DECLINED/ACCEPTED/EXPIRED via
  `quoteExpiresAt`). Rejects audit-logged as `INBOUND_REPLY_REJECTED`.
- F4: inbound fan-out per-recipient errors now write `captureError` +
  `INBOUND_FAN_OUT_FAILED` audit row instead of being swallowed.
- F5: `verifyAuth` fails closed in production when
  `INBOUND_WEBHOOK_SECRET` is unset.
- F6: HMAC signature bumped from 16 to 32 hex chars (64 to 128 bits) in
  `src/lib/inbound-email.ts`.
- F7: `rateLimit("messages", user:<id>)` on POST `/api/messages` at
  20/min/user.
Migration: `20260606000000_add_message_inbound_fingerprint`.

**PLH-3c (2026-05-26).** Buyer post-purchase + OEM dashboard audit. 9
commits, 1 CRITICAL + 5 HIGH + 3 MEDIUM + 1 LOW closed.
- F0 (CRITICAL): `/orders/[id]` page was previewable by anyone, auth
  values computed but never enforced. Added `if (!isBuyer && !isAdmin
  && !isOrderSupplier && !isGuestViaToken) notFound()` gate.
  `orderViewUrl()` helper in `src/lib/order-link.ts` signs a per-order
  HMAC token off `ORDER_LINK_SECRET` (falls back to `SESSION_SECRET`)
  and all outbound order emails embed `?t=<token>` for guest access.
- F1: soft brand model. `Product.manufacturer` must now match a User
  with `role="MANUFACTURER"` and a claimed `manufacturerName`.
  `src/lib/manufacturers.ts` exposes `listClaimedManufacturers()` and
  `isClaimedManufacturer()`. Supplier product create/edit form renders
  a dropdown instead of a free input. Existing products with unclaimed
  manufacturers stay visible until edited.
- F2: partial unique index on `User.manufacturerName WHERE
  role='MANUFACTURER'` so race conditions in the
  `/api/account/profile` PATCH conflict check can't double-claim a
  brand.
- F3: `ManufacturerApplication` model with PENDING/APPROVED/REJECTED
  status. New OEMs no longer get an instant public storefront; admin
  approves at `/admin/manufacturer-applications`. Migration includes
  auto-approve backfill for existing OEMs. Three new emails:
  `sendOemApplicationSubmitted` (admin), `sendOemApplicationApproved`
  (OEM), `sendOemApplicationRejected` (OEM with reason).
- F4: guest invoice access via the same `?t=` signed-token URL pattern
  as F0.
- F5: 30-day post-delivery return window. New `Order.deliveredAt`
  column stamped at the three Delivered transition sites (cron, ops,
  buyer confirm-receipt). Returns API rejects past the window with
  admin-override exemption. Buyer UI shows "X days left to open a
  return."
- F6: `tagline.trim().slice(0, 140)` (was reversed, caused UI char
  count drift).
- F7: `sendOrderCancelled` email from the cancel endpoint via
  `after()`.
- F8 (LOW): OEM logo blob path now includes `crypto.randomBytes(8)`
  suffix to break deterministic URL guessing.
Migrations: `20260607000000_unique_oem_manufacturer_name`,
`20260607010000_add_manufacturer_application`,
`20260607020000_add_order_delivered_at`.

**Cumulative across P12 + PLH-1 + PLH-2 + PLH-3a + PLH-3b + PLH-3c +
PLH-3d: 27 CRITICAL + 58 HIGH closed.** Every `npx next build` since
P12 has compiled clean. Zero em dashes throughout. (See PLH-3e block
below for the updated scorecard after that round.)

**PLH-3d (2026-05-26).** Svix signature verification for Resend inbound
webhooks. 1 commit. Code-side gap from PLH-3b F5 closed.
- `verifyAuth(req, provider, rawBody)` now dispatches on provider.
  Postmark keeps its X-Postmark-Webhook-Token timing-safe-equal check.
  SendGrid keeps the `Authorization: Bearer` shared-secret check.
  Resend uses Svix v1: reads `svix-id`, `svix-timestamp`,
  `svix-signature`; rejects on > 5 min timestamp drift; strips the
  `whsec_` prefix and base64-decodes INBOUND_WEBHOOK_SECRET into HMAC
  key bytes; computes `HMAC-SHA256(key, ${id}.${ts}.${rawBody})` in
  base64 and timing-safe-compares against each `v1,<sig>` entry in the
  header.
- `handleInbound` captures `req.text()` exactly once before verify and
  parse (Svix needs the unparsed bytes; calling `req.text()` /
  `req.formData()` twice consumes the body). The provider-specific
  parsing logic moved into `parseBodyFromRaw(rawBody, provider, req)`.
  Resend payload reader now also handles the `{ type, data: { ... } }`
  envelope shape Resend ships.
- PLH-3b F5 fail-closed rule preserved: production with no
  INBOUND_WEBHOOK_SECRET returns 401; dev passes through.
- No new migration. No new test infrastructure (no existing inbound
  vitest file to extend).

**PLH-3e (2026-05-26).** Targeted hardening round, 8 commits. Section A
shipped 3 verified fixes. Section B evaluated 10 unverified claims, 5
shipped and 5 dropped.
- F1 (CRITICAL): `/api/checkout-from-quote/[id]` now returns 410 when
  `quote.quoteExpiresAt` is in the past. Closes the gap where an
  ACCEPTED-then-expired quote could still produce a PENDING Order at
  the original locked price.
- F2 (HIGH): same route now requires `user.emailVerified` (admins
  exempt). Mirrors the verify gate already in place on `/accept` and
  `/api/quotes/[id]` quote action.
- F3 (HIGH): `/api/admin/applications/[id]` approve block wrapped in
  `prisma.$transaction`. Re-reads `app.status === "PENDING"` inside
  the transaction, throws ALREADY_REVIEWED so a concurrent second
  POST returns 409 instead of duplicating Supplier + SupplierMember
  rows. All writes use `tx.`.
- B2 (HIGH): `PATCH /api/quotes/[id]` "quote" action now rejects
  suppliers whose `status !== "APPROVED" || !publicVisible`. The
  existing `userHasAccessToSupplier` only verified membership; this
  closes the same suspended-supplier gap PLH-1 commit 3 closed for
  orders.
- B7: bank last-4 in audit metadata replaced with first-8-hex of
  `sha256(last4)`. Investigators still see "did it change?" via the
  previous-vs-new hash mismatch; the audit log no longer leaks the
  digits.
- B8: `POST /api/applications` precheck rejects new applications when
  a User row with `role=SUPPLIER` and a SUSPENDED Supplier already
  exists for the email. Returns 400 "Contact support to reactivate."
- B9: `/api/cron/connect-sync` now MAX_PER_RUN=200, `orderBy: { id:
  "asc" }`, returns `{ ok, processed, disabled, errors, hasMore }`.
  Mirrors PLH-2 Phase 4e auto-deliver / reserve-release pattern.
- B10: `PATCH /api/admin/suppliers/[id]` go-live flip (publicVisible
  false to true) now reads readiness inputs + writes the update
  inside a single `$transaction`. Concurrent doc deletion or product
  deactivation cannot race the gate.

Section B drops:
- B1: `/api/supplier/products/[id]` already gates through
  `effectiveAccessToSupplier(product.supplierId)` after the findUnique;
  no defensive rewrite needed.
- B3: stock/price concurrent edit deferred. No simple inline fix; the
  real solution is optimistic concurrency (updatedAt + check). Backlog.
- B4: `/api/supplier/ai-assistant` reads only the calling supplier's
  own data, not a tenant crossing. No escalation path. Cap on top-N
  SKUs would need refactor that doesn't pay back.
- B5: Shippo fallback UX needs schema changes (freightSource on the
  rate, render path on checkout summary). Non-trivial, backlogged.
- B6: surcharge trust deferred; real fix needs address-validation API.

No new migrations. Every `npx next build` since PLH-3d still
compiles clean. Zero em dashes.

**Cumulative across P12 + PLH-1 + PLH-2 + PLH-3a + PLH-3b + PLH-3c +
PLH-3d + PLH-3e: 28 CRITICAL + 62 HIGH closed.** (See PLH-3g block
below for the post-refactor scorecard.)

**PLH-3g (2026-05-26).** Full multi-supplier order refactor across 9
phases on the same branch. Closes the launch-time single-supplier-cart
constraint. Shipped sequentially as P1..P9, every phase building cleanly
on the previous and `npx next build` green between each.
- **P1 (schema).** New `OrderSupplierSlot` model: one row per Order per
  distinct supplier, carrying `subtotalCents`, `freightCents`,
  `feeCents`, `refundedCents`, optional `payoutId`. Unique on
  `(orderId, supplierId)`. Hand-authored migration
  `20260608000000_add_order_supplier_slot`.
- **P2 (cart + checkout client).** `DifferentSupplierError` and the
  modal/banner guards removed from `AddToCart`, `QuickAddButton`,
  `CartClient`. `/cart` and `/checkout` group by supplier in the UI so
  the buyer sees one freight quote per supplier slot.
- **P3 (POST /api/orders).** Server-side single-supplier rejection
  removed. Per-supplier slot math computed and 1 `OrderSupplierSlot`
  row created per supplier in the same `$transaction` as the Order.
  Slot freight uses the server-verified Shippo cents when matched;
  surcharges distributed pro-rata across slots so slot freight cents
  always sum exactly to the order freight total. Sanity belt asserts
  slotSubtotalSum and slotFreightSum match the Order row.
- **P4 (payment + payouts).** `markOrderPaid` and the payouts module
  iterate per slot. Each slot gets its own Payout row via the 3-stage
  flow from P12 commit 2 (stage 1 stake-out, stage 2 transfer, stage
  3a settle + Math.min, stage 3b leave-alone-on-failure). Per-supplier
  transfers fire to each supplier's Connect destination account.
- **P5 (per-supplier shipment dispatch).** Slot-level
  `shipmentStage` / `carrier` / `trackingCode` / `trackingUrl` /
  `shippedAt` / `deliveredAt` columns. `markSlotShipped()` shared
  helper. Order-level `shipmentStage` recomputed as the aggregate
  (Pending if any slot is Pending; Shipped if all slots Shipped;
  Delivered once all slots Delivered). Admin per-slot ship UI was
  flagged as deferred and queued as a post-launch backlog item.
  Migration `20260608010000_add_order_supplier_slot_shipment_fields`.
- **P6 (per-supplier refund routing + clawback).** Refund route accepts
  an optional slot scope (`slotId` or itemId). Slot/item-scoped refunds
  decrement only that slot's `refundedCents` and clawback only that
  supplier's reserveBalance + owedToPlatformCents. Order-level full
  refunds iterate all slots. `RefundResult.slotSupplierName` returned
  for downstream email/audit context.
- **P7 (buyer UI + invoice + email).** `/orders/[id]` renders per-slot
  cards with supplier header, items filtered to that slot, per-slot
  shipmentStage badge, tracking, totals. `/orders/[id]/invoice` shows
  per-supplier sub-sections when slots > 1. `sendOrderConfirmation` and
  `sendOrderDelivered` render per-supplier sections automatically.
  `sendOrderShipped({ slotSupplierId })` opt fires per-slot ship emails;
  the aggregate roll-up email fires once when the last slot ships.
  `sendOrderRefunded({ scopeSupplierName })` opt for scoped refunds.
- **P8 (supplier dashboard).** `/supplier` orders surface scoped to the
  caller's own slot. The supplier sees their slot's items, totals,
  shipmentStage, ship/track actions, and refund history. Suppliers
  never see another supplier's slot data on a shared multi-supplier
  order. Admin per-slot ship UI re-flagged as deferred (post-launch).
- **P9 (this phase).** Multi-supplier seed scenario added: one PAID
  order from buyer Jordan Buyer across Relay & Protection Partners +
  Gridline Power Supply, with 2 OrderSupplierSlot rows and the
  matching Invoice row. Stable reference `PP-MULTI1` so reseed is
  idempotent. Per-supplier slot math extracted into
  `computePerSupplierSlots()` in `src/lib/order-totals.ts` so the
  route and any future Vitest tests share the same code path. No
  Vitest installed at this round, so no new test files landed (the
  helper extraction is the test-readiness artifact). `npx next build`
  clean. Zero em dashes throughout PLH-3g.

Migrations new in PLH-3g:
- `prisma/migrations/20260608000000_add_order_supplier_slot`
- `prisma/migrations/20260608010000_add_order_supplier_slot_shipment_fields`

**Cumulative across P12 + PLH-1 + PLH-2 + PLH-3a + PLH-3b + PLH-3c +
PLH-3d + PLH-3e + PLH-3g: 28 CRITICAL + 62 HIGH closed, plus the
launch-time single-supplier-cart constraint resolved by the PLH-3g
multi-supplier refactor.**

**PLH-3h (2026-05-26).** Multi-image product galleries (build plan
Phase J). 5 phases shipped sequentially on the same branch. Replaces
the single `Product.imageUrl` with a real ordered gallery model.
- **P1 (model + backfill).** New `ProductImage` Prisma model
  (productId, url, alt, ordinal, createdAt; unique `(productId,
  ordinal)`). Migration backfills one ordinal-0 row per existing
  Product from `Product.imageUrl`. `Product.imageUrl` retained as a
  legacy fallback this round, kept in sync with the primary image on
  every mutation, queued for removal in a future round once all
  consumers migrate.
- **P2 (supplier image manager).** New `/supplier/products/[id]/images`
  page plus upload/reorder/delete/set-primary/alt API routes. 5 MB
  per image, 12 images per product, magic-byte MIME check (PNG/JPEG/
  WEBP only), random suffix in the blob path per the PLH-3c F8
  pattern, rate-limited via the `supplier` bucket, every mutation
  audit-logged (`IMAGE_UPLOADED`, `IMAGE_DELETED`, `IMAGES_REORDERED`,
  `IMAGE_SET_PRIMARY`, `IMAGE_ALT_UPDATED`).
- **P3 (buyer carousel).** Buyer-side carousel + lightbox on the
  product detail page. Pure React + Tailwind, no library. Thumbnail
  strip, keyboard navigation, lightbox on click. Single-image and
  zero-image paths preserved.
- **P4 (CSV multi-image).** Catalog CSV import recognizes `images` /
  `image_urls` columns as pipe-separated URL lists and creates one
  ProductImage per URL in ordinal order. Legacy single `imageUrl`
  column still works.
- **P5 (orphan blob sweep).** New cron at
  `/api/cron/orphan-blob-sweep`. Lists every Vercel Blob under the
  `products/` prefix with pagination, deletes any whose URL is not
  referenced by a `ProductImage` row AND whose `uploadedAt` is older
  than 7 days. The 7-day grace covers the rare race where the upload
  route writes the blob but fails before inserting the DB row.
  Bounded `MAX_PER_RUN=500`, mirrors the PLH-2 4e cap-and-resume
  pattern (returns `{ processed, deleted, errors, hasMore }`).
  Per-deletion audit row `ORPHAN_BLOB_DELETED`. Per-blob errors
  caught via `captureError` rather than aborting the run.
  `vercel.json` schedules it daily at 06:00 UTC, after the 03/04/05
  housekeeping crons and before the 09:xx money crons.

New audit action in PLH-3h: `ORPHAN_BLOB_DELETED` (P5). Other image
actions landed in P2.

`npx next build` clean across P1..P5. Zero em dashes throughout
PLH-3h.

**Cumulative across P12 + PLH-1 + PLH-2 + PLH-3a + PLH-3b + PLH-3c +
PLH-3d + PLH-3e + PLH-3g + PLH-3h: 28 CRITICAL + 62 HIGH closed, plus
the single-supplier-cart constraint lifted by PLH-3g and multi-image
product galleries shipped by PLH-3h.**

**PLH-3i (2026-05-26).** QuickBooks Online OAuth full sync (build
plan Phase K endgame). 5 phases shipped sequentially. Replaces the
CSV-import substitute from P12 commit 5 with real Intuit API sync.
- **P1: OAuth + IntegrationCredential model + admin connect page.**
  New `IntegrationCredential` table (provider + realmId unique,
  accessToken / refreshToken / expiresAt, connectedByUserId,
  connectedAt, lastUsedAt). `src/lib/qbo-auth.ts` helper for the
  Intuit OAuth dance + token refresh. Routes
  `/api/admin/integrations/quickbooks/{start,callback,disconnect}`.
  Minimal `/admin/integrations/quickbooks` page. Signed-CSRF state
  on the OAuth start. 503 when `INTUIT_CLIENT_ID` /
  `INTUIT_CLIENT_SECRET` unset; defaults `INTUIT_ENVIRONMENT` to
  sandbox.
- **P2: invoice sync on markOrderPaid via after().**
  `src/lib/qbo-sync.ts` `syncInvoice()` posts a QBO Invoice with
  line items, freight, fee, references PartsPort order ref in
  `DocNumber`. Caches `User.qboCustomerId`. Stores `qboInvoiceId`
  on the PartsPort Invoice. `QBO_INVOICE_SYNCED` audit on success,
  `QBO_SYNC_FAILED` + `captureError` on failure (never blocks
  buyer checkout).
- **P3: refund sync on refundOrder via after().** `syncRefund()`
  posts a QBO RefundReceipt against the invoice's `qboInvoiceId`,
  stores `qboRefundReceiptId` on the Refund row.
  `QBO_REFUND_SYNCED` audit on success, same fail-soft pattern
  as P2 on failure.
- **P4: daily reconcile cron.** `/api/cron/qbo-reconcile`,
  scheduled 07:00 UTC in `vercel.json`. Two-pass invoice + refund
  backfill over the last 30 days, `MAX_PER_RUN=200` per pass, ASC
  ordering, `hasMore` flag (PLH-2 4e + PLH-3e B9 pattern).
- **P5: admin dashboard widget + manual reconcile.**
  `/admin/integrations/quickbooks` expanded to a full dashboard:
  status card (connected / not connected, realmId, connectedAt,
  lastUsedAt, Disconnect button), sync-stats grid (invoices
  synced, refunds synced, pending invoice syncs, pending refund
  syncs, sync failures in last 7 days), recent-activity table
  (last 10 `QBO_*` audit rows), and a "Run reconcile now" button
  wired to a new admin route
  `/api/admin/integrations/quickbooks/reconcile`. The cron body
  extracted into `src/lib/qbo-reconcile.ts` `runQboReconcile()`;
  both the cron route and the new admin route call it. New audit
  action `QBO_RECONCILE_RAN`.

Owner task before this works in prod: Conrad creates an Intuit
developer app, sets `INTUIT_CLIENT_ID` + `INTUIT_CLIENT_SECRET` +
`INTUIT_ENVIRONMENT` (`sandbox` or `production`) in Vercel, then
clicks Connect on `/admin/integrations/quickbooks` and completes
the Intuit OAuth consent screen.

Known gap: access + refresh tokens are stored raw in `@db.Text`.
The repo has no `ENCRYPTION_KEY` infra at this round. Queued
post-launch backlog item in `docs/ORCHESTRATOR.md`: encrypt
tokens at rest once that infra lands.

`npx next build` clean across PLH-3i P1..P5. Zero em dashes
throughout.

**Cumulative across P12 + PLH-1 + PLH-2 + PLH-3a + PLH-3b + PLH-3c +
PLH-3d + PLH-3e + PLH-3g + PLH-3h + PLH-3i: 28 CRITICAL + 62 HIGH
closed, plus the single-supplier-cart constraint lifted by PLH-3g,
multi-image product galleries shipped by PLH-3h, and QuickBooks
Online full OAuth sync shipped by PLH-3i.**

**PLH-3f (2026-05-26).** Conversational AI catalog import assistant
at `/supplier/catalog-import`. Single feature, three commits.
- New `src/lib/import-mapping.ts`: pure mapping primitives (no
  Prisma). `inferMapping(headers)` heuristically maps source
  columns to PartsPort fields by header similarity. `applyMapping`
  produces canonical PartsPort rows with transforms (`identity`,
  `cents-to-dollars`, `dollars-to-cents`, `literal`, `boolean`)
  and row filters (`totals`, `empty`, custom regex).
  `validateRow` mirrors the field-level checks the existing
  POST /api/supplier/products applied. `detectDelimiter` samples
  the first ten lines.
- New `src/lib/import-ai.ts`: Anthropic streaming wrapper.
  `streamMappingHelp` returns an async iterable of text chunks.
  Constant system prompt with ephemeral `cache_control` explains
  the PartsPort schema and the required final JSON shape
  `{ explanation, proposed_mapping, proposed_filters }`. Supplier
  data goes in the user turn so the system cache keeps hitting.
  4000-char cap on `userMessage`. Model `claude-sonnet-4-6` mirrors
  the supplier AI assistant. 503 when `ANTHROPIC_API_KEY` unset.
- Extended `/api/supplier/catalog-import` route to multiplex on
  `body.action`. `"parse"` reads raw CSV/TSV/Excel-clipboard or a
  base64 `.xlsx` blob, returns delimiter + headers + 25-row sample
  + inferred mapping. `"chat"` streams the AI reply. `"commit"`
  applies the supplied mapping + filters, runs field +
  `isClaimedManufacturer` validation, runs the existing PLH-2
  Phase 4a batched-transaction insert path (100-row batches,
  P2025/P2002 row-level errors, partial-result tail). Legacy
  `{ csv, commit }` body still works for the existing
  `CatalogCsvImport` component (preserved inline).
- New rate-limit buckets: `import-ai` (30/hr/supplier) for chat,
  `catalog-import` (30/hr/supplier) for parse/commit. Auth-gated
  to SUPPLIER role with `canEditCatalog`.
- New `/supplier/catalog-import` page with three-panel client UI
  (`AICatalogImport.tsx`). Left: paste textarea + `.csv/.tsv/.xlsx`
  uploader + manual mapping dropdowns + current-filters readout.
  Center: AI chat panel streaming via `fetch` + `ReadableStream`
  reader (mirrors `SupplierAIAssistant.tsx`); after each reply,
  extracts the final fenced JSON block and swaps the proposed
  mapping + filters in. Right: live preview of the first 25 rows
  with red-tinted rows on validation failure. Bottom: `Import all
  (N rows)` button disabled until valid count > 0.
- Audit: `IMPORT_AI_ASKED` per chat turn (question hash, no raw
  text). `CATALOG_IMPORT_COMMITTED` on commit with rowCount,
  mappingHash, filterHash, created/updated/invalid counts, batch
  results. Both added to `AUDIT_ACTIONS`.
- New supplier-dashboard tile at the top of the catalog section
  linking to the assistant; the legacy CSV import block stays in
  place below it.
- Dependency added: `xlsx` (SheetJS community build) for
  in-memory `.xlsx` parsing. 2 MB cap, never persisted to disk.
- No schema changes.
- `npx next build` clean. Zero em dashes. `/supplier/catalog-import`
  ships at 5.01 kB / 113 kB First Load JS.

**PLH-3g P7 (2026-05-26).** Buyer UI for per-supplier shipments and
invoice section breakdown.
- `/orders/[id]` page now fetches `supplierSlots` (with supplier
  identity). Single-supplier orders render unchanged. Multi-supplier
  orders render a stacked card-per-slot block above the invoice summary:
  supplier header with per-slot shipmentStage badge, items filtered by
  `product.supplierId`, per-slot subtotal/freight/fee/refunded, slot
  tracking card (uses `slot.trackingUrl` when set, otherwise builds via
  the `trackingLink` helper from carrier+code), and per-slot
  shippedAt/deliveredAt timestamps. The legacy aggregate tracking card
  only renders for single-supplier orders.
- `/orders/[id]/invoice` page: single invoice with per-supplier
  sub-sections when slots > 1. Each section shows supplier header, that
  supplier's items, section subtotal, section freight. Order-level
  totals (subtotal/freight/fee/tax/total) stay at the bottom unchanged.
- `src/lib/email.ts`: `OrderLite.supplierSlots` (optional) carries
  per-slot data; `isMultiSupplier`, `itemsForSlot`, `slotBlock`,
  `perSupplierSections` helpers added. `sendOrderShipped` gains
  `{ slotSupplierId? }` opt: when present and order is multi-supplier,
  renders a single-supplier-scoped email ("Supplier X shipped their
  portion"); when omitted on a multi-supplier order, renders the
  aggregate roll-up. Single-supplier orders unchanged.
  `sendOrderConfirmation` and `sendOrderDelivered` render per-supplier
  sections automatically when slots > 1. `sendOrderRefunded` accepts an
  optional `scopeSupplierName` parameter so scoped (slot/item) refunds
  email reads "Supplier X's portion refunded" rather than the generic
  "order refunded".
- `src/lib/shipping.ts`: `loadOrderLite(orderId)` helper exported.
  `markSlotShipped` after()-block now uses it, fires the per-slot ship
  email, and (when the just-shipped slot was the last) fires a single
  aggregate roll-up email.
- `src/lib/refunds.ts`: `RefundResult.slotSupplierName` returned for
  slot/item-scoped refunds. The refund route passes it through to
  `sendOrderRefunded`.
- Three Delivered email call sites (auto-deliver cron, ops route, buyer
  confirm-receipt) now re-fetch via `loadOrderLite` so the email body
  reflects per-supplier sections on multi-supplier orders.
- `/cart` and `/checkout` already group by supplier from PLH-3g P2; no
  changes needed.
- Design choice: per-slot ship emails are more informative for buyers
  who care about which part of the order is on the way. The aggregate
  roll-up still fires once when the LAST slot ships so the buyer has a
  single "all shipments are now on the way" record. Delivered email
  stays aggregate-only (the 30-day return window opens on full
  delivery, so a per-slot delivered notification would be confusing).
- `npx next build` clean. Zero em dashes. No new migration.

**Inbound email is now LIVE and proven on prod (2026-05-26).** All four
env vars set in Vercel Production + Preview/claude-branch:
`INBOUND_EMAIL_PROVIDER=resend`,
`INBOUND_EMAIL_DOMAIN=reply.partsport.agentgaming.gg`,
`INBOUND_REPLY_SECRET` (HMAC key for per-thread Reply-To token signing),
`INBOUND_WEBHOOK_SECRET=whsec_*` (Svix signing secret from Resend).
Resend webhook endpoint (`/api/email/inbound`) is configured to fire
`email.received` events. Cloudflare DNS holds verified MX + SPF + DKIM
records on `reply.partsport.agentgaming.gg` (inbound MX:
`inbound-smtp.us-east-1.amazonaws.com priority 10`).

**Smoke test on prod 2026-05-26:** POST a Svix-signed payload to
`/api/email/inbound` with a known-good `whsec_*` signature. Response
`200 {"ok":true,"ignored":"no reply token"}` confirms the code path
end-to-end: provider check passed (not 404), Svix verification passed
(not 401), reply-token parse step reached and correctly skipped because
the test `to:` was not a real reply address.

Remaining real-world verification: a buyer or supplier replies to an
actual PartsPort thread email. Resend's inbound parse forwards the
message to `/api/email/inbound`, the Svix check passes, the route
parses the signed Reply-To token, creates a Message row with
`inboundFingerprint` set, and fans out the email to other thread
members. Audit log will show any `INBOUND_FAN_OUT_FAILED` rows on
failure.

**Next up: real-world verification + production cutover.** No more
code-side polish rounds planned. See ship-ready playbook in
`LAUNCH_PLAN.md`. Cutover steps queued: Stripe live-mode keys flip,
demo data wipe, first real supplier (THRADD) onboarding, attorney
review of legal pages, optional brand rename + entity separation
(rehosting off the AgentRad / agentrad orbit per Conrad's plan).

## Launch-time constraints

These are intentional limitations the platform ships with at soft launch.
Each has a follow-up queued in `docs/ORCHESTRATOR.md` for the post-launch
roadmap.

(None at present. The previous single-supplier-cart constraint was
lifted by PLH-3g, which landed the full multi-supplier refactor:
OrderSupplierSlot rows per Order, per-supplier payment intent splits,
per-supplier shipment dispatch, per-supplier refund clawback, and the
admin per-slot ship UI deferred as a post-launch backlog item.)

Live preview URL (this serves the public-facing site today):
https://rok-preview-git-claude-industrial-marketplace-rowau-agentrad.vercel.app

Infrastructure set up and working:
- Vercel project `rok-preview`. Framework Preset = Next.js. Deployment Protection OFF
  (publicly viewable). Production slot still points at `master`; PartsPort serves from
  the branch below. `NEXT_PUBLIC_SITE_URL` set so canonicals/sitemap/og:url all use a
  stable host.
- Neon Postgres database connected (`partsport-db`, Free plan). Build auto-runs
  migrations + seed.
- Next.js 15.2.6 (patched for the react2shell CVE).
- Email: Resend account; domain `partsport.agentgaming.gg` verified (DKIM/SPF/MX live
  on Cloudflare DNS). `RESEND_API_KEY` is set in Vercel.
- AI search is live (`ANTHROPIC_API_KEY` set; small pay-as-you-go cost per search).
- Stripe in test mode: Stripe Connect (Marketplace, Express) enabled, Stripe Tax
  activated. Live keys to be flipped after first real test order passes cleanly.
- Shippo test API key set as `SHIPPO_API_KEY`. UPS (US) enabled via Shippo's
  managed carrier account. FedEx unavailable. Real label printing will be verified
  on first real order.
- Upstash Redis set up for production rate limiting (`UPSTASH_REDIS_REST_URL` +
  `UPSTASH_REDIS_REST_TOKEN` in Vercel).
- Sentry SDK is now SERVER-ONLY (the client bundle uses lightweight window listeners
  posting to `/api/error-log`). `SENTRY_DSN` is set in Vercel.
- `CRON_SECRET` set in Vercel. 4 daily crons (reconcile, reserve-release,
  payout-retry, health-check) fail-closed without it.
- Vercel Analytics + Speed Insights both live (auto-injected by Vercel).

Pending owner tasks (not code): real product photography (suppliers will upload),
attorney review of 5 legal pages (currently template drafts with disclosure footnote),
custom domain, optional brand rename. First real supplier (THRADD) lined up for
onboarding.

## Repo
- GitHub `AgentRad/rok-preview`, branch `claude/industrial-marketplace-ROwAU`, PR #1 open.
- `master` is the old static "Ring of Keys" site this project replaced.

## Stack & architecture
- Next.js 15.2.6 (App Router) + TypeScript, Prisma ORM, PostgreSQL.
- Auth: hand-rolled cookie sessions (JWT via `jose`, bcrypt). Roles BUYER / SUPPLIER /
  ADMIN / MANUFACTURER. Manufacturer (OEM) accounts carry a `manufacturerName` and get a
  read-only demand/storefront dashboard at `/oem`.
- Payments: PayPal sandbox when env keys are set; built-in demo checkout otherwise.
- Search: Anthropic API for natural-language catalog search when `ANTHROPIC_API_KEY` is
  set; heuristic keyword fallback otherwise. See `src/lib/search.ts`.
- Key dirs: `src/app` (pages + `api` routes), `src/components`, `src/lib`, `prisma`.
- Data model (`prisma/schema.prisma`): User, Supplier, Product, Order, OrderItem,
  SupplierApplication, QuoteRequest, SearchEvent.

## Remaining build plan
Prioritized. Post-purchase communication (A, B, E) is the biggest gap. Build in order,
commit + push per phase, `npx next build` must pass first. Match the existing design
system. No em dashes in any copy.
- **A. Invoicing** (no account needed). `Invoice` Prisma model; generate inside
  `markOrderPaid()` in `src/lib/order-utils.ts`; print-styled invoice page at
  `src/app/orders/[id]/invoice/page.tsx`; list invoices in `/admin`.
- **B. Buyer order tracking** (no account). On `src/app/orders/[id]/page.tsx` show a
  Paid -> Processing -> Shipped -> Delivered timeline and surface `carrier` and
  `trackingCode` to the buyer.
- **C. Product reviews** (no account). `Review` model; only buyers with a delivered
  order for that product can post; show real reviews + average on the product page.
- **D. Saved addresses** (no account). `Address` model linked to User; address book on
  `/account`; checkout picks a saved one.
- **E. Email notifications** (Resend is READY; `RESEND_API_KEY` already in Vercel).
  `npm i resend`, gate on `RESEND_API_KEY`, no-op when absent. Send order confirmation,
  order shipped (with tracking), supplier-application result, password reset. Add a
  password-reset flow (`PasswordResetToken` model + request/reset pages).
- **F. Stripe payments** (SHIPPED: keys live in Vercel, Stripe Tax enabled).
  Hosted Stripe Checkout, card + ACH. Routes `/api/payments/create-session`
  and `/api/payments/webhook` (provider-agnostic abstraction at
  `src/lib/payments.ts` — adding another processor swaps a driver).
  Gate on `STRIPE_SECRET_KEY`, demo fallback kicks in when missing.
- **G. Supplier payouts** (no account). `Payout` model; create on dispatch; show on
  `/supplier`; admin marks paid from `/ops`.
- **H. Catalog at scale** (no account). Pagination + brand/manufacturer filter on
  `/catalog`.
- **I. Returns/RMA + order cancellation** (no account). `ReturnRequest` model;
  buyer-initiated cancellation for unfulfilled orders.
- **J. Multi-image galleries** (no account). Replace `Product.imageUrl` with a
  `ProductImage` model; carousel on the product page.
- **K. QuickBooks** (deferred). Admin-only CSV export of invoices in QuickBooks-importable
  columns. Do NOT build full Intuit OAuth sync.
Not yet assigned to a phase: product recommendations, rate limiting on auth/search
endpoints, per-page SEO metadata.

## Owner / browser-only tasks
- Vercel env vars set: `ANTHROPIC_API_KEY`, `SESSION_SECRET`, `RESEND_API_KEY`. Still
  needed when those phases land: `STRIPE_SECRET_KEY`,
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`.
- Stripe: webhook points at `<deploy-url>/api/payments/webhook` (NOT
  `/api/stripe/webhook`. The route lives under the processor-agnostic
  `/api/payments/*` namespace).
- **Inbound email threading activation (PLH-2 Phase 1).** Set the three
  `INBOUND_*` env vars in Vercel (see Environment variables section above):
  `INBOUND_EMAIL_PROVIDER=resend`, `INBOUND_REPLY_SECRET=<32-char random>`,
  `INBOUND_EMAIL_DOMAIN=reply.partsport.agentgaming.gg`. Then in the Resend
  dashboard add the inbound email domain (`reply.partsport.agentgaming.gg`,
  with the MX records Resend supplies pointed at Cloudflare DNS) and point
  its webhook at `<prod-url>/api/email/inbound`. Until the env vars are
  present the route returns 404 by design.
- Product photos: owner supplies; image URLs go on listings.
- A rename of the product/brand is planned for later.

## Conventions
- Design system in `src/app/globals.css`: editorial / industrial, warm off-white,
  hairline borders, Hanken Grotesk + IBM Plex Mono, near-black primary buttons, amber
  accent. Keep new UI consistent with it.
- **No em dashes anywhere in copy.** Use commas, colons, or periods.
- Product illustrations are line-art SVGs in `src/components/PartIcon.tsx` (fallback for
  missing photos).
- Catalog content (suppliers, products) is seeded from `prisma/seed.mjs`. The seeder is
  idempotent and insert-only: it will NOT update existing rows on re-seed.
- `npx prisma migrate dev` for every schema change; commit the generated migration.
  `npx next build` must pass before every commit.

## Auto-paste the next prompt (STANDING RULE, no exceptions)

When Conrad pastes a build chat's report into the orchestrator chat,
the orchestrator's single response MUST do all of these:

1. Verify the build chat's claims against the repo
2. Update CLAUDE.md status + docs/ORCHESTRATOR.md per the
   doc-maintenance rule
3. Auto-paste the NEXT round's prompt at the bottom of the same
   response, as a copy-paste-ready code block

Do NOT ask "do you want me to paste the next one?" Do NOT split it
across multiple turns. Conrad's flow is paste-in → paste-out →
paste-forward.

**Queue order for PartsPort (post-PLH-3g):**

1. **PLH-3f** — `docs/PLH-3f-AI-IMPORT-ASSISTANT.md` (conversational
   AI catalog import)
2. **PLH-3h** — `docs/PLH-3h-MULTI-IMAGE-GALLERIES.md`
3. **PLH-3i** — `docs/PLH-3i-QUICKBOOKS-OAUTH.md`
4. **PLH-3j** — `docs/PLH-3j-DEFERRED-POLISH.md`

When a round above ships clean, paste the next one in this order. If
the build chat finished partially (some fixes didn't land, build
broken), the next prompt is a FIX-FORWARD prompt for that same round
instead, with a clear surface of what broke.

If the queue empties (all four shipped) and no new rounds are queued,
only then ask Conrad what to work on next.

## Disk hygiene (STANDING RULE)

After a polish round or migration, sweep the working tree for dead
weight before pushing. Targets to delete without asking:

- `.next/`, `dist/`, `out/`, `.vercel/`, `.turbo/` build caches
- `*.log`, `*.tsbuildinfo`, `test-runs/`
- `node_modules/.cache/`, Playwright browser caches if no test run is
  queued
- Curl cookie jars (`jar.txt`, `cookies.txt`, `*.cookie-jar`). These
  are also a security risk (PartsPort has rotated `SESSION_SECRET`
  once after `jar.txt` was committed)
- Probe scripts and one-off `*-test.mjs` / `*-probe.mjs` / `*-out.txt`
  files the testing team drops in the repo root (already covered by
  `.gitignore` but worth pruning from disk too)

Never delete: source code, MD docs, schema files, prisma migrations,
`.local-secrets.env`, anything under `.claude/`.

## Doc maintenance (STANDING RULE for every chat, NO EXCEPTIONS)

Any chat that ships or verifies work on this repo MUST update the
in-repo MD files in the same branch BEFORE moving on. Not later, not
"when convenient," not "if Rad asks." Right after verification.

**Ownership:**

- The orchestrator / brains chat owns the update when it's the one
  verifying a build chat's report. It has the verification context and
  the cumulative scorecard. It writes the canonical entry.
- The build / working chat owns the update when it ships and Rad
  confirms in chat without an orchestrator in the loop.
- When both chats exist on a round: orchestrator updates after
  verification. Build chat does NOT re-edit the same section (avoids
  merge conflicts on the shared branch).
- A fresh chat opening this repo reads CLAUDE.md + docs/ORCHESTRATOR.md
  first. If those docs lag the real state, the previous chat failed
  this rule and the next chat fixes the drift in its first commit.

**Files to keep current:**

- `CLAUDE.md` Status section: extend whenever a round, fix, or major
  feature ships. Include final state (scores, bundle size, what
  shipped, what's pending), migration filenames, cumulative scorecard.
  Flip the "Next up" line to reflect the new next-blocker.
- `docs/ORCHESTRATOR.md`: mark roadmap items DONE when they close.
  Extend the audit-rounds section on every new round. Flip "pending"
  lines.
- `LAUNCH_PLAN.md`: update when a business decision changes (fee rate,
  vertical scope, processor choice, etc.).

**What NOT to do:**

- Don't update docs prematurely (only after verification).
- Don't leave a draft in chat instead of editing the file. Chat drafts
  are not durable.
- Don't write em dashes into these docs. Periods, colons, commas only.
- Don't assume the other chat will handle it. If you have the context,
  you own the update.

The point: every fresh chat that opens this repo can read
CLAUDE.md + docs/ORCHESTRATOR.md and immediately know the real state
without needing Rad to re-brief them.

## Spawning new chats (STANDING RULE — DO NOT VIOLATE)
Every new chat (build chat, verify chat, design chat, audit subagent,
etc.) needs to be briefed inside the kickoff prompt itself. Rad will
NOT drag-and-drop MD files into chat windows. Do not ask him to.
Do not write prompts that say "attach HABITS.md before sending."
Make the prompt self-contained.

Two cases:
- **Claude Code chats with repo access** (build chat, verify chat,
  audit subagents): the prompt can say "Read these files first:
  CLAUDE.md, HABITS.md, docs/ORCHESTRATOR.md" because those chats
  have filesystem access to the repo. Add STRATEGY_CONTEXT.md or
  LAUNCH_PLAN.md when relevant. Add docs/TEAM_TESTING.md for
  verify/test chats. These chats can actually open and read the files.
- **Claude desktop / web chats WITHOUT repo access** (design chat,
  marketing chat, anything outside the repo): the kickoff prompt
  MUST contain all needed context inline. Paste the relevant MD
  excerpts directly into the prompt body. No attachments. No "go
  read this file" instructions. The chat is clueless about the
  filesystem and Rad isn't uploading anything. If the prompt is
  long, it's long.

**Role-specific briefs in the repo** (for repo-access chats):
- `docs/ORCHESTRATOR.md` · for the orchestrator chat
- `docs/DESIGN_CHAT.md` · for the design / video / marketing-asset chat
- `docs/TEAM_TESTING.md` · for verify / test chats
- `HABITS.md` · personal preferences (read in any chat)

When spawning a repo-access chat for a specific role, point it at the
matching brief plus CLAUDE.md as the first thing to read.

Minimum brief that MUST appear inside every kickoff prompt for a
no-repo-access chat (pasted text, not file refs):
1. Who Rad is + how he works (the relevant excerpts from HABITS.md)
2. What PartsPort is + business model (the relevant excerpts from
   CLAUDE.md "What it is" + "Business model" sections)
3. Current state of the project (1-paragraph summary of CLAUDE.md
   Status section)
4. The specific task this chat is being spawned to do
5. Brand voice rules (no em dashes, no emojis unless asked,
   editorial/industrial design language, Hanken Grotesk + IBM Plex
   Mono, near-black buttons, amber accent)
6. Demo URLs + credentials if the chat needs to reference the live site

If a chat seems lost or asks Rad to re-brief, the kickoff prompt
missed something. Fix the prompt, do not make Rad answer the same
question twice.

## Run locally
Needs Node.js and Postgres. `npm install`, set `.env` (`DATABASE_URL` +
`DATABASE_URL_UNPOOLED`), `npx prisma migrate deploy`, `node prisma/seed.mjs`,
`npm run dev`.

## Demo accounts
Password `demo1234`: `buyer@partsport.example`, `supplier@partsport.example`,
`admin@partsport.example`, `oem@partsport.example` (manufacturer, Siemens). Only the
buyer login is shown publicly in the on-site demo guide.

## Environment variables
Required: `DATABASE_URL` + `DATABASE_URL_UNPOOLED`. Set in Vercel: `ANTHROPIC_API_KEY`,
`SESSION_SECRET`, `RESEND_API_KEY`. Optional / future: `PAYPAL_CLIENT_ID` /
`PAYPAL_CLIENT_SECRET` / `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `STRIPE_SECRET_KEY` /
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET`. The build runs
`prisma migrate deploy` + seed, so deploys come up populated.

**Inbound email threading (PLH-2 Phase 1)**. Setting all three turns on
reply-by-email so order and RFQ message threads accept inbound replies and
post them back into the right thread. Until `INBOUND_EMAIL_PROVIDER` is set,
`/api/email/inbound` returns 404 (feature off, fail-closed).
- `INBOUND_EMAIL_PROVIDER` (set to `resend` for Resend Inbound; also accepts
  `postmark` or `sendgrid`).
- `INBOUND_REPLY_SECRET` (any random 32-char string; HMAC key that signs the
  per-thread token embedded in the Reply-To address).
- `INBOUND_EMAIL_DOMAIN` (e.g. `reply.partsport.agentgaming.gg`, the domain
  configured for inbound parsing at the provider).
- Optional `INBOUND_WEBHOOK_SECRET` to require a shared secret on the inbound
  webhook (sent as `Authorization: Bearer <secret>`, or
  `X-Postmark-Webhook-Token` for Postmark).
