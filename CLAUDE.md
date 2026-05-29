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
  `src/lib/inbound-email.ts`. (REVERTED 2026-05-27, see PLH-3n: 32-char
  sig pushed the Reply-To local-part to 66 chars, over RFC 5321's 64
  limit, and Resend silently 422'd every thread email. Restored to 16
  hex chars / 64 bits, which is still strong for a short-lived
  per-thread token.)
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

**PLH-3j (2026-05-26).** Deferred polish batch from the post-PLH-2
backlog. 17 fixes, one commit each, all shipped sequentially. Closes
most of the MEDIUM/LOW debt that PLH-2 + PLH-3 audits explicitly
deferred.
- **P1 (146d84e):** address book hard cap of 25 per buyer. Counted
  inside the same `$transaction` as the create so two concurrent
  POSTs cannot both race past the limit. 400 with "Address book is
  full. Delete an unused address first." when the cap is hit.
- **P2 (ff95d80):** soft-delete Address. `Address.deletedAt` nullable
  timestamp + `(userId, deletedAt)` index. DELETE flips the column
  instead of removing the row, so historical Orders that snapshotted
  the ship-to from this address keep their reference. Read paths
  (address book list, tax-exempt queries, admin attention,
  stripe-tax lookup) filter `deletedAt = null`. New audit action
  `ADDRESS_SOFT_DELETED`.
- **P3 (d7b54d0):** phone format validation via `libphonenumber-js`.
  `validateAddress` parses phone against the address country; invalid
  numbers reject 400 with structured `{ field: "phone", error }`.
  Blank phone still passes (phone is optional).
- **P4 (44069a6):** tax-exempt cert expiry + reminder cron.
  `Address.taxExemptExpiresAt` nullable + index. Upload UI exposes
  an optional date input; the file POST and URL POST both carry
  `expiresAt` through. `lookupTaxExemption` filters out expired
  certs so checkout no longer waives tax on a stale cert. New cron
  `/api/cron/tax-exempt-expiry` (04:30 UTC) emails buyers 30 days
  out via `sendTaxExemptExpiryNotice`, audit-logs
  `TAX_EXEMPT_EXPIRY_NOTICE`, with a 25-day idempotency guard.
- **P5 (6b87bc3):** re-subscribe affordance on the unsubscribe
  response page. New `/api/email/resubscribe` route accepts the same
  signed token, re-verifies, and flips `notifyMarketingEmails` back
  to true. The unsubscribe HTML now renders a Re-subscribe button
  inline.
- **P6 (e135419):** `MAX_PER_RUN=200` + ASC + `hasMore` on the
  remaining crons (anonymize-deleted-accounts, cleanup-unverified-
  accounts, payout-retry). health-check is a fixed-size probe set
  (no per-row backlog) so it returns `hasMore: false` for response
  shape consistency.
- **P7 (f1fd73d):** reconcile mismatch AuditLog dedupe. Partial
  unique index `AuditLog_reconcile_mismatch_dedup_uniq` on
  `(action, targetId, metadata->>'kind', metadata->>'windowStart')`
  scoped to `RECONCILIATION_MISMATCH`. The reconcile cron writes
  mismatch rows via raw `INSERT ... ON CONFLICT DO NOTHING`.
- **P8 (86ca793):** refund amount visible on the buyer's order page.
  Order page include now pulls the most recent Refund row; renders
  "Refunded on `<date>`: $X.XX" below the Total when
  `Order.refundedCents > 0`.
- **P9 (8d04464):** cancel idempotency. POST
  `/api/orders/[id]/cancel` returns 409 with
  `{ error: "Order is already cancelled." }` when status is already
  CANCELLED (was a misleading 200 ok-true).
- **P10 (f546f5e):** `/account` order history pagination. Initial
  server load takes 25; new `OrderHistoryTable` client component
  streams subsequent pages from `/api/account/orders?page=N`.
  Where-clause pins to the calling user's id so the `page` param
  cannot leak another buyer's orders.
- **P11 (eb12762):** `/admin/audit` pagination already shipped at
  P9.5 build (50-per-page, page query param, Previous/Next links,
  indexed filter columns). No code change; inline comment documents
  the verification so a future audit does not re-flag.
- **P12 (856533b):** supplier-health alert thresholds configurable
  via env. `SUPPLIER_HEALTH_REFUND_RATE` / `_DAYS_TO_SHIP` /
  `_OWED_CENTS` / `_INACTIVE_DAYS` with the prior hardcoded defaults
  (0.05, 7, 0, 30). Alert labels render the active threshold.
- **P13 (22497e2):** `manufacturer` editable on supplier Product
  PATCH. Validated via `isClaimedManufacturer` (PLH-3c F1 soft-brand
  model). Empty string is allowed (clear a stale legacy value).
- **P14 (82dd7be):** product ownership belt-and-suspenders. PATCH
  resolves the product via
  `findFirst({ id, supplierId: { in: ownedSupplierIds } })` for
  non-admin callers, where `ownedSupplierIds` unions
  `SupplierMember` and legacy direct-ownership rows. The existing
  role check stays for the role split.
- **P15 (1e12b55):** cancel order email respects notification
  preferences. `sendOrderCancelled` now gates through
  `shouldSendToUser(order.buyerId, "order")` when the order has a
  logged-in buyer (PLH-3b F1 pattern). Guest orders still send
  unconditionally.
- **P16 (f436e85):** OEM logo blob cleanup on re-upload. PLH-3c F8
  randomized the path which kills URL guessing but means a same-path
  overwrite no longer evicts the prior blob. POST now reads the
  previous `manufacturerLogoUrl`, then `del()`s it from Vercel Blob
  after the DB row points at the new URL. Best-effort + Sentry on
  failure.
- **P17 (89809bf):** `scripts/README.md` documenting the smoke-test
  scripts pattern, the no-secrets-in-script rule, the curl cookie
  jar trap, and the post-leak rotation playbook.

Migrations new in PLH-3j:
- `prisma/migrations/20260611010000_address_soft_delete`
- `prisma/migrations/20260611020000_tax_exempt_expires_at`
- `prisma/migrations/20260611030000_reconcile_mismatch_dedup`

New dependency: `libphonenumber-js` (P3, tree-shakable phone parsing).

`npx next build` clean across all 17 commits. Zero em dashes throughout
PLH-3j.

**Cumulative across all rounds including PLH-3j: 28 CRITICAL + 62 HIGH
closed, plus the launch-time single-supplier-cart constraint lifted by
PLH-3g, multi-image product galleries shipped by PLH-3h, QuickBooks
Online full OAuth sync shipped by PLH-3i, and the post-PLH-2 deferred-
polish backlog now closed by PLH-3j.**

**PLH-3k (2026-05-27).** Buyer-UX strip-back round. 13 fixes, one
commit each, sequential push. Pure UI strip-back; no schema changes.
Surfaced by a THRADD-style first-pass read of the product detail and
cart pages reading as "feature not ready" / "too many words."
- F1 (`aed19ad`) CRITICAL: lifted the stale "Multi-supplier checkout
  will go live shortly" callout in CartClient. PLH-3g shipped the
  backend; the UI gate was vestigial. Multi-supplier carts proceed
  to checkout unchanged.
- F2 (`0f1451b`) HIGH: removed the "Buy now" button on the product
  page. Replaced with a small muted "Or skip cart and check out now"
  link below Add to Cart. Old `tryAdd("buy")` handler refactored.
- F3 (`9d10aaa`) HIGH: stripped the beige fee-note callout from the
  product page. Replaced with a tiny muted single-line badge
  "Verified seller · freight handled by PartsPort". 6% fee
  disclosure now lives in checkout only. Unused `FEE_RATE_LABEL`
  import removed.
- F4 (`c7b6ca8`) HIGH: dropped the "New supplier" tag next to
  supplier name. Computed-rating block still renders when reviews
  exist; nothing renders when zero. Verified badge from F3 covers
  trust signaling.
- F5 (`30f7486`) MEDIUM: dropped the "No reviews yet" prefix from
  the rating line on the product page. Zero-review state renders
  just "SKU <sku>".
- F6 (`f9a2e2b`) MEDIUM: removed the inline ZIP freight estimator
  from the product page. Deleted `FreightEstimateWidget.tsx` and
  the `/api/freight/estimate` route (both dead code paths after
  removal). Added a tiny "Freight estimated at cart" muted link
  in its place.
- F7 (`1bda8aa`) MEDIUM: collapsed the 3-row ETA/Availability/
  Sold-by table in the product buybox into one muted line: "10
  days · 24,000 in stock · <supplier name>". Computed-rating
  block appended when present. Unused `next/image` import dropped.
- F8 (`bcc8c2e`) HIGH: dropped the "Marketplace fee (6%)" line
  from the cart breakdown. Fee folds silently into the order
  total. Server-side fee compute in `/api/orders` POST and the
  shared `computeOrderTotals` unchanged; this is UI-only.
  Unused `FEE_RATE_LABEL` import removed from CartClient.
- F9 (`cb34ee2`) MEDIUM: collapsed the per-supplier section
  headers in the cart when only one supplier is present. The
  multi-supplier header still renders when `groups.length >= 2`.
- F10 (`fd286e8`) MEDIUM: demoted the manufacturer label in cart
  line items from colored caps (`cl-mfr`) to small muted text on
  the same line as price/unit/ETA. Product name stays prominent.
- F11 (`dc79da8`) LOW: dropped the "Sales tax: $0.00" row and the
  wordy multi-clause caveat from the cart summary. Replaced with a
  single muted "Tax calculated at checkout." line directly above
  the Order total row. Freight-quoted addendum preserved when the
  cart includes large equipment.
- F12 (`b275f24`) LOW: restricted the top utility marketing bar
  to marketing routes only. New `src/components/TopBar.tsx`
  client component uses `usePathname()` to render only on `/`,
  `/how-it-works`, `/for-suppliers`, `/for-manufacturers`.
  Buyer-context gate in `SiteHeader` preserved. Hidden on every
  other route (product detail, catalog, cart, checkout, orders,
  account, supplier, admin, etc.).
- F13 (`aa0a527`) LOW: collapsed the Manufacturer filter behind a
  native `<details>` expander on `/catalog`. Category filter
  unchanged. Auto-opens when a manufacturer filter is active so
  deep-linked `/catalog?mfr=X` keeps the selected state visible.

No schema changes in PLH-3k. No new migrations. No new dependencies.
Every `npx next build` between commits compiled clean. Zero em dashes.

**Cumulative across all rounds including PLH-3k: 28 CRITICAL + 62 HIGH
closed, plus the single-supplier-cart constraint lifted by PLH-3g,
multi-image galleries shipped by PLH-3h, QuickBooks Online full OAuth
sync shipped by PLH-3i, the post-PLH-2 deferred-polish backlog closed
by PLH-3j, and the buyer-UX strip-back round shipped by PLH-3k.**

**PLH-3l (2026-05-27).** Supplier dashboard IA split. 8 commits, one
per phase, sequential push. The previous `/supplier` was a single
giant scroll mixing daily-ops signals (stats, attention, ship queue)
with infrequent setup (logo, legal docs, warehouses, payout method,
team). PLH-3l carves it into 5 tabs: Dashboard, Products, Quotes,
Payouts, Settings. SupplierNav is sticky across all surfaces.
- P1 carved out `/supplier/products`, `/supplier/payouts`,
  `/supplier/quotes`, `/supplier/settings` as thin auth-gated wrappers
  rendering a new `SupplierNav` (server component, `active` prop sets
  highlighted tab). Existing `/supplier/catalog-import` URL preserved.
- P2 pure refactor: 13 sections extracted from `/supplier/page.tsx`
  into `src/components/supplier/*` (StatsRow, AttentionPanel,
  GoLiveReadiness, CompanyLogoEditor, LegalDocsEditor,
  WarehousesEditor, PayoutMethodEditor, CatalogEditor, TeamManager,
  ReserveBalanceCard, PayoutsTable, QuoteRequestsTable,
  IncomingOrdersTable). Shared per-supplier data loaders live in
  `src/components/supplier/data.ts`. Zero visual diff.
- P3 wired each sub-route to render only its sections.
  `/supplier/products` = CatalogEditor (manager + AI import tile + CSV
  import + orders.csv export). `/supplier/payouts` = ReserveBalanceCard
  + PayoutsTable. `/supplier/quotes` = QuoteRequestsTable.
  `/supplier/settings` = full GoLiveReadiness + CompanyLogoEditor +
  LegalDocsEditor + WarehousesEditor + PayoutMethodEditor +
  TeamManager.
- P4 trimmed `/supplier` itself to daily ops: SupplierNav + header +
  StatsRow + AI assistant tile + AttentionPanel + GoLiveReadiness +
  CompactTiles. All editor cards removed from the dashboard; available
  under their sub-routes.
- P5 GoLiveReadiness on the dashboard gets `hideWhenComplete`, so
  once readiness is 10/10 AND the supplier is public, the checklist
  disappears from the dashboard. Full checklist still renders at
  `/supplier/settings`.
- P6 CompactTiles 1-line summaries: "📋 N open RFQs · oldest D days
  → View all", "📦 N paid orders awaiting ship → View orders", "💰 $X
  in payouts due → View payouts". Whole tile clickable; tile grid
  returns null when nothing is pending.
- P7 SupplierNav sticky (`position: sticky; top: 0; z-index: 40`) via
  a `sticky` prop. All five surfaces pass it. Breadcrumb "Supplier →
  <Section>" added above `page-title` on each sub-route using the
  existing `.breadcrumb` class.
- P8 docs + internal link cleanup. `actionHref` strings in
  `src/lib/attention.ts` swapped from `/supplier#payouts` to
  `/supplier/payouts`, and the low-stock attention link from
  `/supplier` to `/supplier/products`. `prisma/seed.mjs` comment
  reference to `/supplier#profile` updated to `/supplier/settings`.
  CLAUDE.md + docs/ORCHESTRATOR.md PLH-3l blocks added.

No schema changes, no new dependencies, no new crons. Pure UI/IA
refactor. Every `npx next build` between commits compiled clean. Zero
em dashes.

**Cumulative across all rounds including PLH-3l: 28 CRITICAL + 62 HIGH
closed, plus the single-supplier-cart constraint lifted by PLH-3g,
multi-image galleries shipped by PLH-3h, QuickBooks Online full OAuth
sync shipped by PLH-3i, the PLH-2 deferred-polish backlog closed by
PLH-3j, the buyer-UX strip-back shipped by PLH-3k, and the supplier
dashboard IA split shipped by PLH-3l.**

**PLH-3m (2026-05-27).** Tiny OEM + admin polish tail surfaced by the
POV-audit pass against the OEM dashboard and admin console. 3 fixes,
one commit each, sequential push. Pure UI strip-back. No schema
changes, no new dependencies, no new crons.
- F1 (LOW): OEM dashboard subtitle trimmed from the three-clause
  "Manufacturer dashboard: your demand, distributors, and sales on
  PartsPort. Every order routes to an authorized distributor, with
  zero channel conflict." down to a one-line muted "Your demand,
  distributors, and storefront on PartsPort." in
  `src/app/oem/page.tsx`.
- F2 (LOW): admin console header tightened in
  `src/app/admin/page.tsx`. Dropped the "Marketplace operations:
  suppliers, applications, and orders." preamble; the quick-links row
  (Fulfillment ops, Audit log, Profit dashboard, Tax registrations)
  stays as the page-sub.
- F3 (LOW): OEM logo upload caption normalized to "PNG / JPG / WEBP,
  square, under 2 MB." in `src/components/OemProfileEditor.tsx`.
  Single combined caption beneath the Upload logo / Replace button.

`npx next build` clean across all three commits. Zero em dashes.

**Cumulative across all rounds including PLH-3m: 28 CRITICAL + 62 HIGH
closed, plus the single-supplier-cart constraint lifted by PLH-3g,
multi-image galleries shipped by PLH-3h, QuickBooks Online full OAuth
sync shipped by PLH-3i, the PLH-2 deferred-polish backlog closed by
PLH-3j, the buyer-UX strip-back shipped by PLH-3k, the supplier
dashboard IA split shipped by PLH-3l, and the OEM + admin polish tail
shipped by PLH-3m. Buyer + supplier + OEM + admin surfaces all
stripped to launch-ready via the POV-audit-driven PLH-3k / 3l / 3m
rounds.**

**PLH-3n (2026-05-27).** CRITICAL inbound-email fix. 1 commit.
- Per-thread Reply-To addresses were silently failing every thread
  email since PLH-3b F6 bumped the HMAC sig to 32 hex chars. The full
  local-part `reply+<kind:1>.<cuid:25>.<sig:32>` ran 66 chars, over RFC
  5321's 64-octet limit, and Resend rejected every send with a 422
  "Invalid reply_to field". `send()`'s try/catch in `src/lib/email.ts`
  swallowed the throw so Message rows saved but no mail left the
  platform. Cut the sig back to 16 hex (64 bits, still strong for a
  short-lived per-thread token). New local-part = 50 chars.
  `parseReplyAddress()` already compared on actual sig length so it
  picked up the new shape with no further code change. Added a
  defensive `throw` in `replyAddress()` if the local-part ever crosses
  64 again, so future cuid format changes fail loud instead of
  silently dropping mail. No tokens in flight to migrate.
- Smoke test 2026-05-27: admin posted a thread message on RFQ-87K9UN
  via `/api/messages`, Message row created, outbound send fired via
  `after()`. Real-world round-trip (reply to inbound webhook,
  `INBOUND_FAN_OUT_OK` + Message row with `inboundFingerprint`)
  pending Conrad's reply from rad@agentgaming.gg.

**PLH-3n bug #2 (2026-05-27).** CRITICAL inbound-email follow-up. 1
commit. Once outbound mail flowed again (sig back to 16 hex), Conrad
replied from rad@agentgaming.gg at 21:46 UTC and the webhook returned
`{"ok":true,"ignored":"empty body"}` — message never landed on the
thread. Root cause: Resend's `email.received` webhook payload is
METADATA ONLY (from, to, subject, email_id, message_id, attachments).
text/html are NOT included; they must be fetched via
`GET https://api.resend.com/emails/receiving/{email_id}` with
`Authorization: Bearer ${RESEND_API_KEY}`.
- Fix in `src/app/api/email/inbound/route.ts`: after `parseBodyFromRaw`,
  if provider=resend and text+html are both empty and the raw payload's
  `data.email_id` is set, fetch the body. On missing `RESEND_API_KEY`,
  non-2xx response, or thrown fetch error, returns
  `200 {"ok":true,"ignored":"body fetch failed"}` + `captureError` /
  console.error so Resend stops retrying instead of looping forever.
  Successful fetch logs `text.length` / `html.length` for future smoke
  tests. Updated the docblock at the top of route.ts to document the
  Resend metadata-only payload shape.
- Real-world verification 2026-05-27: re-fired Conrad's actual reply
  (email_id `e95dafe3-b8a0-4a22-a94e-e43d92ac93be`, body "got it")
  against the live preview webhook with a freshly Svix-signed payload.
  Response `200 {"ok":true,"posted":"quote","id":"cmpokkr5y0003l704715ph61l"}`.
  Message row created with `inboundFingerprint` set, fan-out fired via
  `after()`. End-to-end Resend inbound round-trip is now proven.

**PLH-3n bug #3 (2026-05-27).** Quoted-reply stripping polish. 1
commit. The first real round-trip on RFQ-87K9UN stored a Message.body
that included the Gmail attribution line ("On ... wrote:" wrapped onto
two lines because Gmail soft-wraps the FROM address) plus the user's
italic-wrapped signature block ("*Conrad Thompson*\nFounder & CEO\n
agentgaming.gg") above it. `stripQuotedReply` only matched
"On ... wrote:" on a single line, and didn't know about
markdown-italic-name sig blocks.
- Extended `stripQuotedReply` in `src/lib/strip-quoted-reply.ts`
  (extracted from `inbound-email.ts` so the test harness can import
  it without the `server-only` guard; the original module re-exports
  it for backwards compatibility). New heuristics: join up to 3
  consecutive lines when probing for "On ... wrote:" so Gmail iOS
  soft-wraps get caught; recognize bare `--` and `__` delimiters in
  addition to RFC 3676 `-- `; cut at a markdown-italic-name line
  (`*Name*`) when the following block is <=4 non-empty lines, each
  <=80 chars and without question marks (conservative — won't eat
  a real sentence that happens to follow an italic phrase).
- Added `scripts/test-strip-quoted-reply.mjs` running via Node 24's
  `--test` + `--experimental-strip-types`. Covers the RFQ-87K9UN live
  example, Gmail iOS wrap, Outlook From/Sent block, Apple Mail single
  "On ... wrote:", no-quoted-history no-op, bare `--` / `--`/`__`
  delimiters, italic-line-with-question negative case, and Gmail `>`
  quote block. 10/10 pass. (Repo has no vitest/jest — PLH-3d block
  flagged this; the Node built-in runner is the zero-dep substitute
  that gets a real signal on the heuristic.)
- `npx next build` clean. Re-triggering the Resend webhook replay
  against `msg_3EKDSD3qDyfPLuguWYl2tQrbfB9` / email_id
  `e95dafe3-b8a0-4a22-a94e-e43d92ac93be` against the live preview
  pending Conrad (needs INBOUND_WEBHOOK_SECRET + RESEND_API_KEY in
  the local shell, or run from Vercel preview shell).

**PLH-3o (2026-05-27).** Thread-message email redesign. 1 commit.
Conrad surfaced that back-and-forth on a thread stacked branded
"New message" cards in Gmail and read like a marketing chain. Real
one-on-one email looks like plain paragraphs plus a quoted block.
- `sendThreadMessage` in `src/lib/email.ts` no longer wraps through
  the `wrap()` scaffold (title bar, beige content card, prominent
  black "Open thread" button, branded footer). New body is just the
  sender's text in plain paragraphs, a separator + standard "On
  <Date> at <Time>, <Name> <email> wrote:" attribution above the
  most recent prior message indented `border-left: 3px solid #ccc;
  padding-left: 12px;`, a 12px gray `Open thread on PartsPort &rarr;`
  text link, and an 11px gray Unsubscribe link as CAN-SPAM footer.
  Gmail collapses deeper thread history under "..." on its own, so
  only the single most recent prior message rides along.
- Plain-text alternative now mirrors the same minimal structure:
  sender body, `> ` quoted attribution + prior message, single
  `Open thread: <url>` line. No ASCII card.
- `send()` now receives `text` and `userId` on this path so Resend
  sends a multipart message and the List-Unsubscribe header uses
  the signed per-user token when we know the recipient.
- New `prevMessage` arg on `sendThreadMessage`. `/api/messages`
  POST and the order + quote branches of `/api/email/inbound`
  each query the latest prior `Message` on the same thread
  (`findFirst orderBy createdAt desc NOT id: created.id`) and pass
  it through. The bounce-back path (unknown-sender) and
  health-check cron pass nothing, so they render as plain notices
  with no quoted block.
- `context` and `subjectPrefix` body interpolations both removed
  from the email body. Subject line still carries `[RFQ <ref>]
  Message from <name>` / `[Order <ref>] Message from <name>` so
  Gmail threads correctly.
- `wrap()` and `btn()` left in place. Every other transactional
  email (order confirmation, payment received, refund, password
  reset, etc.) still uses the branded card.
- `npx next build` clean. Zero em dashes.

Smoke-test still pending Conrad: send admin -> buyer message on
RFQ-87K9UN, open the email in Gmail, source-view the HTML, paste
back so Conrad can eyeball that it reads as a paragraph + small
quoted block + one gray link (no card). Reply from Gmail and
confirm the new Message row posts cleanly via the PLH-3n bug #3
strip-quoted-reply path.

**PLH-3p (2026-05-27).** Threading parity round. 4 sequential
commits, one per feature, all on the same branch. Brings the
messaging surface up to feature parity with a normal multi-party
ticket system: team-wide fan-out, internal-note visibility, unread
badges, and file attachments. Every commit `npx next build` clean.
Zero em dashes throughout.
- **F1 (`0426640`)**: team fan-out. New
  `resolveSupplierThreadRecipients(supplierId)` helper in
  `src/lib/supplier-access.ts` returns every active
  `SupplierMember` user with `canSendMessages` permission, plus the
  legacy single-owner `Supplier.userId` and the supplier's
  `contactEmail`, deduped by lowercased email. POST `/api/messages`
  (both order and quote branches) and the order + quote branches
  of `/api/email/inbound` swapped their per-supplier
  `contactEmail` send for the fan-out so every teammate gets
  threaded. `sendThreadMessage` is also gated through
  `shouldSendToUser` (PLH-2 4d notify-order-emails preference) so
  any teammate who opted out is silently skipped. The posting user
  themselves is dropped from the recipient set so suppliers do not
  email themselves on their own reply.
- **F3 (`3f06b10`)**: visibility enum. New `MessageVisibility`
  Prisma enum (`PUBLIC`, `SUPPLIER_INTERNAL`, `BUYER_INTERNAL`,
  `ADMIN_ONLY`), defaulted to `PUBLIC`. New
  `src/lib/message-visibility.ts` holds
  `resolveOutgoingVisibility(requested, role)` (server-side write
  authority: buyers can only post `PUBLIC`, suppliers can post
  `PUBLIC` or `SUPPLIER_INTERNAL`, admins can post any),
  `visibilitiesVisibleTo(role)` (read-side filter), and the
  `emailsBuyer` / `emailsSupplierTeam` predicates that gate the
  fan-out. Order + quote pages filter `messages` through the
  viewer's allowed visibility set before passing to
  `MessageThread`. Composer renders a "Visible to" dropdown for
  suppliers and admins; the option list is gated by role so a
  buyer never sees the toggle. Internal notes render with a
  colored left-border and an uppercase visibility chip (amber for
  supplier-internal, gray for admin- and buyer-internal). Outbound
  fan-out checks `emailsBuyer` / `emailsSupplierTeam` so an
  internal note never emails the wrong side.
  Migration: `prisma/migrations/20260628010000_add_message_visibility`.
- **F4 (`aa7341f`)**: unread badges. New `ThreadLastRead` Prisma
  model: one row per `(userId, threadKind, threadId)`. New
  `src/lib/messages.ts` `getUnreadCounts(userId)` returns per-thread
  unread counts (admin sees all, supplier sees orders/quotes with
  items from any of their supplier memberships, buyer sees their
  own orders/quotes); excludes messages sent by the user; honors
  the F3 visibility filter; treats absence of a `ThreadLastRead`
  row as "all messages unread" so badges light on first inbound.
  New PATCH `/api/messages/mark-read` accepts
  `{ threadKind, threadId }`, runs the same access check as the
  thread itself, and upserts `ThreadLastRead.lastReadAt = now`.
  `MessageThread.tsx` fires the PATCH once on mount whenever the
  viewer is signed in. SiteHeader's Messages link renders a pill
  badge with `getUnreadCounts(user.id).total`; the orders + quotes
  list pages render per-row badges from the `byThread` map.
  Migration: `prisma/migrations/20260628020000_add_thread_last_read`.
- **F2 (`06426ed`, this commit)**: file attachments. New
  `MessageAttachment` model (`messageId`, `fileName`, `fileSize`,
  `mimeType`, `blobUrl`, `createdAt`, `@@index([messageId])`,
  cascade on Message delete). New POST + GET
  `/api/messages/[id]/attachments`. POST requires the calling user
  to pass the same access check as the thread AND be the message's
  `senderId` or an admin; runs the bytes through a magic-byte MIME
  sniffer (PNG / JPEG / PDF / DOCX only, DOCX detected via
  `PK\x03\x04` + `.docx` filename suffix); 5 MB max per file, 5
  files max per message; rate-limited via the existing `messages`
  bucket. Files land in Vercel Blob under
  `messages/{messageId}/{8-hex-suffix}-{filename}` (PLH-3c F8
  pattern). Each successful upload writes a
  `MESSAGE_ATTACHMENT_UPLOADED` audit row. GET returns the
  thread-visible attachments after the F3 visibility filter so a
  buyer cannot enumerate attachments on a supplier-internal note.
  POST `/api/messages` now returns `{ ...message, attachments: [] }`
  so the client knows to follow up with per-file uploads. Inbound
  webhook integration: when a Resend `email.received` payload
  carries `attachments[]`, each item's `download_url` is fetched
  with `Authorization: Bearer ${RESEND_API_KEY}`, magic-byte
  checked, capped at 5 MB / 5 per message, and uploaded to Blob;
  failures write an `INBOUND_ATTACHMENT_FAILED` audit row and
  `captureError` but never fail the inbound (the message itself
  still posts). `sendThreadMessage` does NOT attach files to the
  outbound Resend email; when attachments exist it appends a
  single muted line `📎 N attachment(s) - view in PartsPort` to
  both HTML and text bodies (the only emoji exception in the
  codebase, per spec). Composer in `MessageThread.tsx` exposes a
  multi-file input below the textarea, renders chips with
  filename + size + remove button for each selected file, and
  posts the message first then uploads each file sequentially
  while the Send button is disabled. Message display renders the
  same paperclip chips below the body, each chip linking to the
  blob URL in a new tab.
  Migration: `prisma/migrations/20260628030000_add_message_attachment`.

New audit actions in PLH-3p: `MESSAGE_ATTACHMENT_UPLOADED` (F2),
`INBOUND_ATTACHMENT_FAILED` (F2). No new dependencies. No new
crons.

Migrations new in PLH-3p:
- `prisma/migrations/20260628010000_add_message_visibility`
- `prisma/migrations/20260628020000_add_thread_last_read`
- `prisma/migrations/20260628030000_add_message_attachment`

**Cumulative across all rounds including PLH-3p: 28 CRITICAL + 62
HIGH closed, plus the single-supplier-cart constraint lifted by
PLH-3g, multi-image galleries shipped by PLH-3h, QuickBooks Online
full OAuth sync shipped by PLH-3i, the PLH-2 deferred-polish
backlog closed by PLH-3j, the buyer-UX strip-back shipped by
PLH-3k, the supplier dashboard IA split shipped by PLH-3l, the OEM
+ admin polish tail shipped by PLH-3m, the thread-email rebuild
shipped by PLH-3n + PLH-3o, and the threading parity round
(team fan-out, visibility enum, unread badges, file attachments)
shipped by PLH-3p.**

**PLH-3s (2026-05-27).** Three targeted AI actions added across the
admin/supplier daily workflow. Reuses the existing supplier AI
assistant pattern: Anthropic Sonnet 4.6 streaming SSE-style, the
`ai-assistant` rate-limit bucket, system prompt cached ephemerally,
token usage written to AuditLog. All three routes 503 when
`ANTHROPIC_API_KEY` unset. 3 commits + docs.
- **B1**: "Draft invoice with AI" button on `/orders/[id]`. Opens a
  modal that streams a Markdown invoice draft from
  `/api/ai/draft-invoice`. Visible only to admin and to supplier
  members on the order whose `canSendMessages` permission is true.
  Modal exposes a "Copy to clipboard" action. No PDF export this
  round (no PDF library in `package.json`; flagged in spec as
  copy-only fallback). Audit: `AI_DRAFT_INVOICE`.
- **B2**: "Summarize my open RFQs" tile on `/supplier` dashboard
  between the AI assistant card and the AttentionPanel. Opens a
  fixed-right side panel that streams a paragraph summary plus the
  top three RFQs ranked by urgency from
  `/api/ai/summarize-rfqs`. Auth via `getActiveSupplierContext` so
  the data scope is always the calling supplier. Audit:
  `AI_SUMMARIZE_RFQS`.
- **B3**: "Draft reply with AI" inline panel above the composer on
  `/quotes/[id]` (RFQ thread page). Streams a brief professional
  reply from `/api/ai/draft-rfq-reply`. System prompt mentions
  specific specs (name/SKU/qty), MAY surface a price range when
  comparable filled orders exist for the same product, and is
  instructed NEVER to commit to a price. "Copy to composer" button
  drops the text into `MessageThread.tsx` via a window CustomEvent
  (`partsport:set-thread-draft`); no auto-send. Audit:
  `AI_DRAFT_RFQ_REPLY`.

New audit actions in PLH-3s: `AI_DRAFT_INVOICE`, `AI_SUMMARIZE_RFQS`,
`AI_DRAFT_RFQ_REPLY`. No new dependencies. No new migrations. No
new crons.

`npx next build` clean across all 3 commits. Zero em dashes.

**Cumulative across all rounds including PLH-3s: 28 CRITICAL + 62
HIGH closed, plus PLH-3g multi-supplier refactor, PLH-3h galleries,
PLH-3i QuickBooks OAuth, PLH-3j deferred polish, PLH-3k buyer UX
strip-back, PLH-3l supplier IA, PLH-3m OEM/admin polish, PLH-3n +
PLH-3o thread-email rebuild, PLH-3p threading parity, and PLH-3s
three targeted AI actions (draft invoice, summarize RFQs, draft
RFQ reply).**

**PLH-3u (2026-05-27).** Fresh-POV onboarding + empty-state + first-use
round driven by `docs/PLH-3t-fresh-pov-audit.md`. 3 commits, copy +
layout only. No schema, no API, no migration.
- **P1 onboarding status + transparency.** `/oem` PENDING
  ManufacturerApplication branch now surfaces `submittedAt`, a "Most
  applications reviewed within 2 business days" timeline, and a
  mailto:rad@agentgaming.gg support line. `/oem` no-brand branch
  replaced with a primary "Claim your brand" CTA to `/manufacturers#apply`.
  `GoLiveReadiness` no longer renders null on ready+publicVisible;
  instead renders a one-line green "You are live, accepting orders"
  confirmation in the slot the checklist used to occupy. `/supplier`
  no-supplier-profile branch was already done at PLH-3l (apply CTA +
  timeline + mailto), verified in place.
- **P2 empty-state nudges.** `/catalog` zero-result state replaced
  with a primary "Open an RFQ instead" CTA (mailto prefilled with the
  search query), plus a muted "AI search may find it" hint when the
  query looks SKU-shaped (regex: mixed letters+digits, 4-30 chars,
  `[A-Za-z0-9._\-\/]`). `CartClient` empty state was already done at
  PLH-3l (Browse catalog primary link). `/supplier/products` empty
  state hoists a hero AI-import tile at the top with "Upload your
  first catalog in 5 minutes" + the metric "Suppliers with 10+ SKUs
  receive RFQs within 7 days on average." `/supplier/payouts` empty
  state renders a single-paragraph explainer about Friday payouts and
  the 5% reserve. `AttentionPanel` caught-up state names the next
  likely action ("Upload more SKUs" / "Respond to new RFQs" /
  "Confirm pending shipments" / "Review pending payouts", falling
  back to "Browse your catalog") computed off `productCount`,
  `openQuotes`, `shipQueueCount`, `payoutsDueCents`. `AddToCart`
  backorder copy adds an inline mailto RFQ link prefilled with the
  SKU.
- **P3 first-time feature surfacing + admin guidance.** `/orders/[id]`
  renders a muted "Message the supplier about this order using the
  thread below. Replies arrive by email too." line above
  `MessageThread`, gated on no `ThreadLastRead` row for the viewer
  on this order thread (PLH-3p F4 plumbing). `/account` shows a
  dismissible "Get set up" card at the top when the buyer has no
  saved address; two CTAs ("Save a delivery address" /
  "Set notification preferences") and a localStorage dismissal key
  `plh3u-account-setup-dismissed`. `/admin/manufacturer-applications`
  gains a static "Approval criteria" card above the queue (verify
  entity exists, real website, brand not already claimed, watch for
  red flags, decline duplicates with reason). `/admin` gains a
  "Today's urgent" card between the AttentionFeed and the AddSupplier
  form, listing up to 5 attention items sorted urgent → warning →
  info. `/admin/supplier-health` gains a "What healthy looks like"
  alert that reads the active configured thresholds.
- **Deviations** (resolved silently per the build spec):
  - `/apply/supplier` and `/apply/oem` routes don't exist. Used
    `/suppliers#apply` for the existing supplier apply target
    (already in place at PLH-3l) and `/manufacturers#apply` for the
    OEM claim flow.
  - No `/suppliers/[slug]` storefront route. GoLiveReadiness
    confirmation banner is text-only with no storefront link.
  - No generic `/rfq?q=` route. `/catalog` zero-result "Open an RFQ
    instead" CTA opens a mailto:rad@agentgaming.gg with the query
    in the subject + body. Same pattern on the backorder link in
    `AddToCart` (mailto with SKU prefilled).
  - `ManufacturerApplication` model only has
    `manufacturerName / submittedAt / reviewedAt / rejectionReason`
    (no `website`/`contactEmail`). Only rendered fields that exist.

Commits: 5016273 (P1), 0aa3cd9 (P2), a14151d (P3). No new
dependencies. Every `npx next build` between commits compiled clean.
Zero em dashes.

**Cumulative across all rounds including PLH-3u: 28 CRITICAL + 62 HIGH
closed, plus PLH-3g multi-supplier refactor, PLH-3h galleries, PLH-3i
QuickBooks OAuth, PLH-3j deferred polish, PLH-3k buyer UX strip-back,
PLH-3l supplier IA, PLH-3m OEM/admin polish, PLH-3n + PLH-3o
thread-email rebuild, PLH-3p threading parity, PLH-3s three AI actions,
and PLH-3u fresh-POV onboarding + empty states + first-use surfacing.**

**PLH-3q (2026-05-27).** Cross-role direct messages. 4 commits, P1..P4.
Adds a generic DM layer on top of the existing per-order / per-quote
thread plumbing so any buyer, supplier, OEM, or admin can start a
conversation not tied to a specific order or RFQ.
- **P1 (c2d268a):** `DirectMessageThread` + `DirectMessageParticipant`
  Prisma models. `Message.directThreadId` nullable FK so the existing
  Message table carries DM posts without a parallel table. New
  `canStartDirectMessage` / `canAddParticipant` helpers in
  `src/lib/dm-permissions.ts` enforcing the role pair rules (buyer can
  DM any vetted supplier or admin, suppliers can DM any buyer with a
  shared order or any admin, admins can DM anyone, OEMs can DM admin
  only for now).
- **P2 (c8c79c1):** `POST /api/dm/threads` (create, subject required,
  1..9 recipients, each checked via `canStartDirectMessage`),
  `GET /api/dm/threads` (caller's own threads, lastMessageAt DESC,
  page-25), `GET /api/dm/threads/[id]` (thread + participants +
  messages from joinedAt onward, role-visibility filtered),
  `POST /api/dm/threads/[id]/participants` (add up to 10 total via
  `canAddParticipant`). Existing `POST /api/messages` already accepted
  `directThreadId`; mark-read extended to `direct` kind.
- **P3 (673f29e):** email fan-out for DM posts via the existing
  `sendThreadMessage` plumbing, per-thread Reply-To
  `reply+d.<threadId>.<sig>` so inbound replies land on the right DM
  thread (mirrors the order/quote pattern from PLH-3n). Respects
  `shouldSendToUser(userId, "order")` opt-out (PLH-2 4d, PLH-3b F1).
- **P4 (9b656d2):** UI. New `/messages` inbox + `/messages/[id]`
  thread page rendered by `MessagesClient.tsx`. Two-column layout
  (thread list left, selected thread right) with a "New conversation"
  modal (recipient search via the existing `GET /api/dm/can-dm`
  hardened in fefcd04), participant chips with an "Add people" modal,
  and a composer that reuses `MessageThread.tsx` (extended to take
  `directThreadId`, no visibility toggle in DM context). Mark-read
  fires on mount via the `threadKind: "direct"` branch. Per-user
  unread badge on `/messages` uses
  `getUnreadCounts(userId).directUnread`; the order/quote unread
  badge stays on the dashboard tab. Messages link wired into
  `HeaderNav` (buyer/supplier/admin), `SupplierNav` (top-right
  tail), and `AdminHeader` (rightmost). OEMs remain DM-able by
  admin only (no `/messages` link, redirected to `/oem`).

P6: OEMs can access the DM inbox (earlier P4 redirect was a bug).

Deferred to a future round: a participant cannot currently leave or
be removed from a DM thread; "Joined X" system notices render when
participants are added but there is no matching "Left X" path yet.

No new migrations in P4 (P1 added them). No new dependencies. Every
`npx next build` between commits compiled clean. Zero em dashes
throughout PLH-3q.

**Cumulative across all rounds including PLH-3q: 28 CRITICAL + 62 HIGH
closed, plus PLH-3g multi-supplier refactor, PLH-3h galleries, PLH-3i
QuickBooks OAuth, PLH-3j deferred polish, PLH-3k buyer UX strip-back,
PLH-3l supplier IA, PLH-3m OEM/admin polish, PLH-3n + PLH-3o
thread-email rebuild, PLH-3p threading parity, PLH-3s three AI actions,
PLH-3u fresh-POV onboarding + empty states + first-use surfacing, and
PLH-3q cross-role direct messages.**

**PLH-3x (2026-05-27).** Enterprise procurement security and legal docs. 1
commit, docs-only. No schema or API changes.
- New `/legal/dpa` page: GDPR + CCPA compliant Data Processing Addendum
  template with parties/scope, definitions, processing scope, instructions,
  sub-processors, data subject rights, security measures, breach
  notification (24-hour target), return/deletion on termination, audits,
  international transfers (SCCs Module 2/3 + UK IDTA), CCPA service
  provider terms, governing law, and signature. Footnote discloses
  AI-drafted from industry-standard examples, attorney review pending
  before signature.
- New `/legal/security` page: one-page security posture summary covering
  encryption (TLS 1.3 in transit, AES-256 at rest via Neon and Vercel
  Blob), authentication (bcrypt + optional TOTP 2FA + server-side session
  invalidation), authorization (role-based + audit logged),
  infrastructure (Vercel US-East, Neon US-East, all data in US),
  vulnerability management (Sentry, Dependabot, build-gated review),
  incident response (24-hour notification target, account isolation),
  compliance status (explicitly: working toward SOC 2 Type II readiness,
  NO current SOC 2 / ISO 27001 / third-party audit claims), retention
  (90-day audit logs, 7-year financial records per IRS), and vulnerability
  reporting channel.
- New `/legal/subprocessors` page: bulleted list of 10 subprocessors
  (Vercel, Neon, Stripe, Resend, Anthropic, Upstash, Shippo, Intuit
  QuickBooks, Cloudflare, Sentry), each with purpose, US processing
  location, and link to provider privacy/security docs. 30-day prior
  notice commitment for additions/replacements.
- New `docs/security-questionnaire-response.md`: reference Q&A covering
  35 common SIG/CAIQ/HECVAT questions across data classification, access
  controls, encryption, BCP/DR, incident response, vulnerability
  management, network security, employee security, vendor management,
  compliance, and retention. Each answer 1-3 sentences, factual against
  PartsPort's actual setup. Honest "no" on SSO/SAML, penetration tests,
  SOC 2, and ISO 27001. Honest in-development on BCP/DR runbook, annual
  awareness training, quarterly restore drill, and SAST/DAST rollout.
- Three new pages linked from `LegalLayout` nav (alongside the existing
  5 legal docs) and from `SiteFooter` (DPA, Security, Subprocessors).
- `CookieConsent` banner now references the DPA below the Privacy Policy
  link for procurement teams reading the consent prompt.
- ALL three pages and the questionnaire doc are AI-drafted templates
  and require attorney review before going public. Voice is conservative
  throughout: nothing claims SOC 2 certified, ISO 27001 certified, current
  third-party audit, or completed penetration testing. The /legal/security
  page explicitly states "PartsPort does not hold a current SOC 2
  attestation and does not hold an ISO 27001 certificate. PartsPort has
  not engaged a third-party auditor."
- `npx next build` clean. Zero em dashes.

**PLH-3v (2026-05-27).** PO numbers on orders for enterprise buyers. 1
commit. New `Order.purchaseOrderNumber` column (nullable, 64-char cap
enforced in the API layer, indexed for substring search). Migration
`20260630000000_add_order_purchase_order_number`.
- Checkout: optional "Purchase order number (optional)" input in
  `CheckoutClient` with helper "Enter your company's PO number for
  invoice reference." 64-char client cap matches the server.
- POST `/api/orders` and POST `/api/checkout-from-quote/[id]` both
  accept `purchaseOrderNumber` (trimmed + sliced to 64). The quote
  path also updates the PO on the re-submit branch.
- `/orders/[id]` renders "PO #: <number>" below the order ref when
  set; admins see an inline `AdminEditPurchaseOrder` editor that
  POSTs `{ action: "po", purchaseOrderNumber }` to
  `/api/ops/orders/[id]`. Edit writes an `ORDER_PO_UPDATED` audit
  row with before/after values.
- `/orders/[id]/invoice` renders "Purchase Order: <number>" in the
  invoice meta header.
- `sendOrderConfirmation` subject suffix appends ` [PO <number>]`
  when set. `OrderLite.purchaseOrderNumber` carries the value.
- `/account` order history table renders a PO column only when at
  least one visible row has a value. Adds a search input that
  re-queries `/api/account/orders?q=<substring>` for case-insensitive
  `contains` matching on `purchaseOrderNumber`. Load-more carries
  the active query.

New audit action: `ORDER_PO_UPDATED`. No new dependencies, no new
crons. `npx next build` clean. Zero em dashes.

**PLH-3w (2026-07-01).** Trust and safety: account suspend/ban,
per-role 2FA enforcement, and abuse-report messaging. 3 feature commits
plus docs.
- **P1 (3d7211f) user suspend/ban + admin tools.** New `UserStatus`
  enum (ACTIVE/SUSPENDED/BANNED) + `User.status` (default ACTIVE) +
  `suspendedAt`/`suspendedReason`/`suspendedByUserId`. New `BannedEmail`
  blacklist (unique lowercased email). Login refuses non-ACTIVE accounts
  with 403 (same generic copy for SUSPENDED and BANNED so the harsher
  state isn't confirmed); register refuses banned emails with a generic
  "registration unavailable" before the existing-user branch. Suspend
  and ban bump `sessionsValidFrom` (kills outstanding cookies), flip the
  user's owned suppliers to `status=SUSPENDED + publicVisible=false`
  (which unpublishes their catalog and trips the existing
  SUSPENDED-supplier order/RFQ gates), and a suspended/banned
  MANUFACTURER drops out of the brand index + storefront via a
  `status: "ACTIVE"` filter on the manufacturer queries
  (`listClaimedManufacturers`, `isClaimedManufacturer`,
  `/manufacturers`, `/manufacturers/[slug]`). Defensive belt on POST
  `/api/orders` rejects a non-ACTIVE session user. New `/admin/users`
  directory: status tabs (All/Active/Suspended/Banned), name/email
  search, per-row Suspend (500-char reason modal) / Unsuspend / Ban
  (terminal, confirm dialog). Admins cannot change their own status.
  Cascade logic lives in `src/lib/user-status.ts`. Audit:
  `USER_SUSPENDED`, `USER_UNSUSPENDED`, `USER_BANNED`. Migrations
  `20260701000000_add_user_status`, `20260701010000_add_banned_email`.
  Deviation: unsuspend does NOT auto-republish the supplier org
  (re-approval + go-live flip is a deliberate admin step). Deviation:
  SUSPENDED is a full login lockout per the explicit login-gate
  requirement, so the spec's "suspended buyer can still view history"
  nuance is not honored (you cannot both block login and let them
  browse). The cascade gates remain as defense in depth.
- **P2 (db68837) per-role 2FA enforcement.** `REQUIRE_2FA_FOR_ROLES`
  env (comma list; tokens ADMIN / SUPPLIER / SUPPLIER_OWNER /
  MANUFACTURER / BUYER, where SUPPLIER_OWNER matches a supplier owner
  via SupplierMember OWNER or legacy userId). `src/lib/two-factor-policy.ts`
  computes per-user state; `TwoFactorGate` server component mounted once
  in the root layout renders a banner during a 24h grace window (from
  `createdAt`) and a blocking fixed-overlay interstitial after grace,
  suppressed by an active admin recovery override. Backup codes moved
  from the legacy `totpBackupCodes` Json to a typed
  `User.backupCodesHashed String[]` (8 codes, sha256 at rest); enroll
  clears it, verify writes it (+ clears legacy), login-2fa checks new
  store first then falls back to legacy for pre-P2 enrollees. New
  `/api/auth/2fa/backup-codes` regenerates 8 (password-confirmed);
  settings shows remaining count, a Generate-new-codes form, and
  download-.txt / copy on the codes screen. Admin 2FA recovery override:
  `User.twoFactorRecoveryUntil` set 1h ahead via the `2fa-recovery`
  action on `/api/admin/users/[id]`, surfaced as a "2FA recovery" button
  per ACTIVE row, audited `USER_2FA_ADMIN_OVERRIDE`. Migration
  `20260701020000_add_user_backup_codes` (adds both columns). Deviation:
  the spec named one P2 migration and a `backupCodesHashed` field only;
  the recovery-override column rides in the same migration since the
  feature needs storage. `generateBackupCodes()` changed 10 to 8.
- **P3 (6a89118) abuse-report messaging.** `Message` gains
  `reportedAt`/`reportedByUserId`/`reportReason`/`reviewedAt`/
  `reviewedByUserId` + a `reportedAt` index. Each message in
  `MessageThread` gets a Report control (reason dropdown
  Spam/Abusive/Off-topic/Other + optional 500-char detail) that POSTs
  `/api/messages/[id]/report`, gated by the same thread-membership +
  visibility check the attachments route uses, idempotent on an
  already-pending report, audited `MESSAGE_REPORTED`. New
  `/admin/reported-messages` queue: pending reports (reportedAt set,
  reviewedAt null) with body, linked thread context (order/quote/DM),
  reporter, and reason. Dismiss marks reviewed (`MESSAGE_REPORT_DISMISSED`
  via `/api/admin/reported-messages/[id]`); Suspend sender links to the
  P1 `/admin/users?q=<email>` flow. Migration
  `20260701030000_add_message_report`.

New audit actions in PLH-3w: `USER_SUSPENDED`, `USER_UNSUSPENDED`,
`USER_BANNED`, `USER_2FA_ADMIN_OVERRIDE`, `MESSAGE_REPORTED`,
`MESSAGE_REPORT_DISMISSED`. New `AuditTargetType` value `Message`. Admin
nav gains Users + Reports links. No new dependencies, no new crons.
`npx next build` clean across all three commits. Zero em dashes.

**Cumulative across all rounds including PLH-3w: 28 CRITICAL + 62 HIGH
closed, plus the trust-and-safety layer (account suspend/ban with
cascading effects, per-role 2FA enforcement with grace + backup codes,
and user-reportable messages with an admin review queue) shipped by
PLH-3w.**

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

**Inbound email is now LIVE on Conrad's agentgaming Resend tenant
(migrated 2026-05-27 off Jenna's safespacesitters tenant).** All four
env vars set in Vercel Production + Preview/claude-branch:
`INBOUND_EMAIL_PROVIDER=resend`,
`INBOUND_EMAIL_DOMAIN=inbound.partsport.agentgaming.gg` (new subdomain
on Conrad's tenant),
`INBOUND_REPLY_SECRET` (HMAC key for per-thread Reply-To token signing),
`INBOUND_WEBHOOK_SECRET=whsec_*` (Svix signing secret from new tenant),
`RESEND_API_KEY=re_*` (outbound, from new tenant, full access).
Resend webhook endpoint (`/api/email/inbound`) is configured to fire
`email.received` events. Cloudflare DNS holds verified MX + SPF + DKIM
records on `inbound.partsport.agentgaming.gg`.

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

## PLH-3y-1: Buyer org foundation (round 1 of 6)

First round of the SSO + buyer-orgs + approvals initiative speced in
`docs/PLH-3y-spec-sso-buyer-orgs-approval.md`. This round lands the buyer
organization foundation only. NOT SSO, NOT approvals, NOT billing, NOT domain
auto-join (those are rounds 2 through 6).

Shipped (5 commits, each `npx next build` clean, zero em dashes):
- Schema: `BuyerOrg`, `BuyerOrgMember`, `BuyerOrgInvite` models +
  `BuyerOrgRole` enum (ADMIN | APPROVER | BUYER | VIEWER) +
  `User.activeBuyerOrgId`. Migration
  `20260702000000_add_buyer_org` (partial unique index keeps one pending
  invite per email + org). Permission helpers in
  `src/lib/buyer-org-access.ts`. APPROVER is a stub this round, treated like
  BUYER; the real approval engine lands in PLH-3y-6. VIEWER is read-only and
  cannot place orders. ADMIN manages members + settings and sees all org
  orders.
- Admin org management: `/admin/buyer-orgs` (create + list, no self-serve),
  `/admin/buyer-orgs/[id]` (add existing accounts, invite new emails, remove
  members, cancel pending invites). Invite flow mirrors the supplier team
  pattern (hashed token, 14-day expiry, `sendBuyerOrgInvite` email).
- Buyer accept flow: `/buyer-org-invite/[token]` +
  `/api/buyer-org-invites/[token]`. Signed-in matching user joins directly;
  new emails register as BUYER and get a session. Accept is idempotent, marks
  the invite accepted, and sets the joined org active.
- Nav org switcher (`BuyerOrgSwitcher`) rendered only when the user belongs
  to 1+ orgs; `/api/buyer-org/switch` writes `User.activeBuyerOrgId`.
  `activeBuyerOrgId` is plumbed through `SiteHeader` for later rounds.
- Audit actions: `BUYER_ORG_CREATED`, `BUYER_ORG_MEMBER_ADDED`,
  `BUYER_ORG_MEMBER_REMOVED`, `BUYER_ORG_INVITE_SENT`,
  `BUYER_ORG_INVITE_ACCEPTED`. New `AuditTargetType` value `BuyerOrg`.

Locked decisions honored: admin-managed only, default invited role BUYER,
switcher shown when 1+ orgs. No new dependencies, no new crons.

## PLH-3y-2: Org shared resources + billing modes (round 2 of 6)

Second round of the SSO + buyer-orgs + approvals initiative. Lands org-level
shared resources and billing. NOT SSO, NOT approvals, NOT domain auto-join
(those are rounds 3 through 6). 6 commits, each `npx next build` clean, zero
em dashes.

- **Schema:** `BuyerOrgBillingMode` enum (MEMBER_PAYS default, HYBRID).
  `BuyerOrg` gains `billingMode`, `stripeCustomerId`, and lifted org tax-exempt
  fields (`taxExemptCertificateUrl`, `taxExemptStatus`, `taxExemptExpiresAt`,
  mirroring the per-Address cert from PLH-3j P4). New `BuyerOrgAddress` model
  for shared shipping addresses (soft-delete via `deletedAt`). Migration
  `20260703000000_add_buyer_org_shared_resources`.
  - Schema choice: a SEPARATE `BuyerOrgAddress` model rather than extending
    `Address` with a nullable `buyerOrgId`. Address.userId is required + cascade
    tied to a user, and the personal book carries per-user 25-cap, soft-delete,
    and per-address tax-exempt logic; a dedicated model keeps all of that
    untouched.
  - Schema choice: org tax-exempt fields live DIRECTLY ON `BuyerOrg` (not a
    separate `BuyerOrgTaxExemption` model) since an org has exactly one cert,
    matching how `Address` carries the per-address cert inline.
  - New audit actions: `BUYER_ORG_ADDRESS_ADDED`, `BUYER_ORG_ADDRESS_REMOVED`,
    `BUYER_ORG_BILLING_MODE_CHANGED`, `BUYER_ORG_STRIPE_CUSTOMER_CREATED`,
    `BUYER_ORG_TAX_EXEMPT_UPDATED`, `BUYER_ORG_ORDERS_EXPORTED`. New access
    helper `canChargeOrgCard`.
- **Shared address book.** `BuyerOrgAddress` CRUD at `/api/buyer-org/addresses`
  (member read, org-ADMIN add via `validateAddress`, org-ADMIN soft-delete at
  `[id]`). New `/buyer-org` org-home page renders an admin-managed shared
  address list. `CheckoutClient` surfaces org shared addresses as a selectable
  ship-to optgroup (value prefixed `org:`) alongside personal addresses.
- **Lifted org tax-exempt cert.** Org ADMIN submits a cert (https URL +
  optional expiry) at `/api/buyer-org/tax-exempt` (status PENDING); a site
  admin approves at `/api/admin/buyer-orgs/[id]/tax-exempt` (PATCH), reviewed
  in a new admin-console "Org tax-exempt certificates" block
  (`OrgTaxExemptReview`). `lookupTaxExemption` now also checks the buyer's
  active org cert (APPROVED + not expired) as an additional source after the
  personal cert.
- **HYBRID billing mode.** Org ADMIN toggles billing mode at
  `/api/buyer-org/billing`; enabling HYBRID lazily creates an org Stripe
  Customer via new `createStripeCustomer` in `lib/payments.ts` (503 when Stripe
  not configured). At checkout, a permitted member (`canChargeOrgCard`) of a
  HYBRID org with a customer may tick "Charge to org account"; `create-session`
  resolves the org and attaches `customer: stripeCustomerId` to the Checkout
  Session (customer and customer_email are mutually exclusive, so email is
  dropped on that path). MEMBER_PAYS stays default; any unmet condition falls
  back to member-pays silently.
- **Spend visibility filter.** `/account` order history gets a "My orders /
  All org orders" toggle for org ADMINs. `/api/account/orders?scope=org`
  returns orders placed by current members of the active org (membership-based
  scope, enforced server-side via `canSeeAllOrgOrders`) with a buyer column.
  Non-admins see only their own.
- **CSV export of org orders.** ADMIN-only `/api/buyer-org/orders.csv` exports
  all org orders using the `csvSafeCell` formula-injection guard from PLH-2 4a.
  "Export CSV" button on the org-scoped order history view. Audited
  `BUYER_ORG_ORDERS_EXPORTED`.

Locked decisions honored: new orgs default MEMBER_PAYS, HYBRID is opt-in by an
org admin, org address book is additive (personal addresses still work).
Org-scope spend visibility is membership-based (no `Order.buyerOrgId` column
this round); a member leaving an org removes their orders from the admin view.
No new dependencies, no new crons. Migration
`20260703000000_add_buyer_org_shared_resources`.

## PLH-3y-3: Domain auto-join + DNS verification (round 3 of 6)

Third round of the SSO + buyer-orgs + approvals initiative. Lands org email
domain claims, DNS TXT verification, and auto-join on register. NOT SSO, NOT
approvals (rounds 4 through 6). 5 commits, each `npx next build` clean, zero
em dashes.

- **Schema:** new `BuyerOrgDomain` model (domain unique, verificationToken,
  status PENDING/VERIFIED/FAILED via new `BuyerOrgDomainStatus` enum,
  verifiedAt, txtLastCheckedAt, autoJoinEnabled default false, autoJoinRole
  default VIEWER) + `BuyerOrg.domains` relation. Migration
  `20260704000000_add_buyer_org_domain`. New `src/lib/free-email-domains.ts`
  (free/disposable provider blocklist + `emailDomain` extractor +
  `normalizeDomainClaim`). Six new audit actions: `BUYER_ORG_DOMAIN_CLAIMED`,
  `_VERIFIED`, `_FAILED`, `_REMOVED`, `_AUTOJOIN_UPDATED`, `_AUTOJOINED`.
- **Domain claim + manage (org ADMIN).** `/api/buyer-org/domains` GET (list,
  any member) + POST (claim; rejects free-email providers and
  already-claimed domains, mints a 16-byte hex verificationToken).
  `/api/buyer-org/domains/[id]` PATCH (toggle autoJoinEnabled + autoJoinRole,
  blocked until status VERIFIED) + DELETE (remove claim). Org-home
  `/buyer-org` "Email domains" card shows per-domain status, the DNS TXT
  record to add (`_partsport.<domain>` = `partsport-verify=<token>`), a
  verified-only auto-join toggle with a VIEWER/BUYER/APPROVER role select
  (ADMIN deliberately not offered as an auto-join role), and a remove button.
- **Verification cron.** `/api/cron/verify-org-domains` resolves TXT on
  `_partsport.<domain>` via `node:dns/promises` `resolveTxt`. PENDING+found
  to VERIFIED (audit on transition); PENDING past a 7-day window to FAILED;
  VERIFIED whose record disappeared to FAILED + autoJoinEnabled forced off.
  MAX_PER_RUN=200, ASC by txtLastCheckedAt nulls-first, `hasMore`. Scheduled
  06:30 UTC in `vercel.json`.
- **Attention card for misconfig.** The org-home page renders a red attention
  banner naming any FAILED domains (record disappeared or never verified), so
  the org admin knows auto-join is paused and the TXT record needs fixing.
- **Auto-join on register.** `autoJoinByEmailDomain(user)` in
  `buyer-org-access.ts` matches a verified email's domain against a VERIFIED +
  autoJoinEnabled org domain, adds the user as a member with the domain's
  autoJoinRole, sets activeBuyerOrgId when unset, audits
  `BUYER_ORG_DOMAIN_AUTOJOINED`. Idempotent, free-email belt, never throws
  into auth. Called from `/api/auth/verify` after the token is consumed (the
  verified email proves domain control); a successful join redirects to
  `/buyer-org?joined=<name>` with a welcome banner. Forward-compatible: the
  PLH-3y-4 SSO JIT path will call the same helper.

Locked decisions honored: auto-join OFF by default per domain (admin opts in
after verification), default auto-join role VIEWER, free-email providers
blocked from being claimed. No new dependencies. New cron slot 06:30 UTC.
Migration `20260704000000_add_buyer_org_domain`.

## PLH-3y-4: SAML SSO + JIT provisioning (round 4 of 6)

Fourth round of the SSO + buyer-orgs + approvals initiative. Lands generic
SAML 2.0 single sign-on with just-in-time provisioning. NOT OIDC, NOT SCIM
(both round 5), NOT approvals (round 6). 4 feature commits + this doc, each
`npx next build` clean, zero em dashes.

- **SAML library (LOCKED).** Uses `@node-saml/node-saml` v5 (the maintained
  successor to passport-saml's core). All XML signature verification,
  assertion condition validation (NotBefore / NotOnOrAfter / audience), and
  canonicalization are delegated to it. PartsPort hand-rolls none of the
  crypto. Pure-JS dependency tree (xml-crypto / @xmldom/xmldom), no native
  deps, so the Vercel build is unaffected. The 3 `npm audit` advisories on the
  tree are pre-existing Next.js + postcss items, not introduced this round.
- **Schema (C1).** `SsoIdpType` enum (SAML | OIDC). `SsoConfig` model (one per
  org, `buyerOrgId` unique): SAML fields (`idpEntityId`, `idpSsoUrl`,
  `idpSloUrl`, `idpX509Cert`, `idpX509CertNext` for zero-downtime rotation),
  OIDC fields present but unused until 3y-5, `domainAllowlist`,
  `groupAttributeName`, `groupRoleMap`, `defaultRole`, `enforced` (default
  false), `sessionMaxAgeMin` (default 480), `honorIdpSessionExpiry` (default
  true). `SsoLoginEvent` high-volume per-login audit table (outcome SUCCESS |
  FAILED_SIG | FAILED_NOTAFTER | FAILED_DOMAIN | FAILED_AUDIENCE, hashed IP).
  `BuyerOrgMember.emergencyPasswordAccess` per-member break-glass flag.
  Migration `20260705000000_add_sso_config`. New audit actions
  `SSO_INITIATED`, `SSO_LOGIN_SUCCESS`, `SSO_LOGIN_FAILED`, `SSO_PROVISIONED`,
  `SSO_CONFIG_UPDATED`, `SSO_CONFIG_REMOVED`, `SSO_CERT_ROTATED`,
  `EMERGENCY_PASSWORD_LOGIN`. New `AuditTargetType` value `SsoConfig`.
- **Core lib + login gate (C2).** `src/lib/sso.ts` wraps node-saml: SP entity
  id / ACS URL helpers, `buildSaml` (accepts current + next cert so a rotation
  is zero-downtime, `wantAssertionsSigned`), `generateSpMetadata`, config
  resolvers (by orgId / by allowlisted email domain / enforced-only),
  `classifySamlError` (maps library throws to the FAILED_* outcomes),
  `provisionSsoUser` (JIT: creates User role BUYER + empty passwordHash +
  emailVerified=now, creates/updates the BuyerOrgMember role from the
  group map, reuses `autoJoinByEmailDomain`), `recordSsoEvent`, and
  `ssoSessionMaxAgeSec`. Group-to-role: highest-privilege mapped group wins
  (ADMIN > APPROVER > BUYER > VIEWER), else defaultRole. `createSession` in
  `auth.ts` gained optional `{ sso, org, maxAgeSec }` so SSO sessions carry
  `sso`/`org` JWT claims and a policy-capped lifetime; password logins keep
  the 30-day default. The login route now enforces the domain lock: when the
  email's domain belongs to an `enforced` org, password login returns 403 with
  an `ssoInitiateUrl`, EXCEPT a platform admin (Role=ADMIN) or a member with
  `emergencyPasswordAccess` (both audited `EMERGENCY_PASSWORD_LOGIN`).
- **Routes (C3).** `GET /api/auth/sso/initiate` (`?email=` or `?orgId=`,
  builds the AuthnRequest, 303s to the IdP). `POST /api/auth/sso/saml/[orgId]/acs`
  (node-saml verifies the signed assertion, enforces the domain allowlist,
  JIT-provisions, opens a session capped by `sessionMaxAgeMin` and, when
  `honorIdpSessionExpiry`, by any SessionNotOnOrAfter; writes the SsoLoginEvent
  outcome). `GET /api/auth/sso/saml/[orgId]/metadata` (SP metadata XML, served
  even before the IdP fields are filled in).
- **Admin UI (C4).** Shared `src/lib/sso-config-admin.ts` (validates the group
  map JSON + role values, normalizes the domain allowlist, detects a
  signing-cert change and stamps `rotatedCertAt` + `SSO_CERT_ROTATED`).
  Org-admin backend `/api/buyer-org/sso` (active-org scoped) and site-admin
  `/api/admin/buyer-orgs/[id]/sso` (Role=ADMIN, path-scoped), both GET/PUT/
  DELETE. One `SsoConfigForm` client renders the SP metadata URL / entity id /
  ACS URL to copy, the IdP fields, provisioning policy, and the enforce toggle.
  Pages `/buyer-org/sso` (org admin) and `/admin/buyer-orgs/[id]/sso` (site
  admin), linked from the org-home and admin org-detail pages.

Deviations: (1) the org-admin SSO page lives at `/buyer-org/sso` (active-org
context) rather than the spec's `/buyer-org/[id]/sso`, matching the rest of
the `/buyer-org` surface. (2) SLO endpoint, SCIM, OIDC, and the dry-run test
route are explicitly out of scope (3y-5 / 3y-6). (3) The spec's "force 2FA when
emergencyPasswordAccess is toggled on" nuance is not wired this round; the flag
is honored at login and exposed via schema, but the team-page toggle + 2FA
coupling is deferred.

Owner setup to test SAML end to end (no env vars needed; config is per-org in
the DB): create or pick a BuyerOrg, open `/admin/buyer-orgs/[id]/sso` (or the
org admin opens `/buyer-org/sso`), copy the SP metadata URL / Entity ID / ACS
URL into an IdP (Okta or Azure AD dev tenant), paste back the IdP Entity ID,
SSO URL, and signing certificate (PEM), set the domain allowlist, Save. Then
visit `/api/auth/sso/initiate?email=<you@allowed-domain>` to round-trip a
login. Flip "Enforce SSO" only after a successful test login, since it disables
password login for that domain (platform admin keeps break-glass).

Security smoke test worth a careful pass: confirm a tampered/unsigned
SAMLResponse to the ACS endpoint is rejected (lands FAILED_SIG in
SsoLoginEvent, no session), an expired assertion lands FAILED_NOTAFTER, and an
email outside the allowlist lands FAILED_DOMAIN. None should create a session
or a User.

Locked decisions honored: generic SAML 2.0 (no vendor code), SSO is free (no
tier gate), `enforced=false` by default, site-admin break-glass always
available. New dependency `@node-saml/node-saml`. No new crons. Migration
`20260705000000_add_sso_config`.

## PLH-3y-5: OIDC + SCIM + cert rotation + SLO (round 5 of 6)

Fifth round of the SSO + buyer-orgs + approvals initiative. Lands generic
OIDC single sign-on, SCIM 2.0 user provisioning, IdP signing-cert rotation,
and single logout. NOT approvals (round 6, the final round). 3 feature
commits + this doc, each `npx next build` clean, zero em dashes.

- **OIDC library (LOCKED choice).** Uses the existing `jose` dependency
  (already in the tree for session JWTs), NOT `openid-client`. The
  security-critical step (ID token signature verification against the IdP
  JWKS plus iss / aud / exp / nonce validation) is delegated to jose's
  `createRemoteJWKSet` + `jwtVerify`; we hand-roll none of the JWT crypto.
  The authorization-code exchange itself is a plain OAuth2 token POST (no
  crypto), done with `fetch`. Rationale: jose is pure-JS, already vetted and
  bundled, and avoids openid-client v6's ESM-only / extra-dependency surface
  on the Vercel build. Generic OIDC works with Google Workspace, Okta OIDC,
  and Azure AD OIDC; no vendor-specific code.
- **Schema.** `SsoConfig` gains `scimEnabled` (default false), `scimTokenHash`
  (unique, SHA-256 hex of the bearer token), `scimTokenLast4` (UI display).
  The OIDC columns (`oidcIssuer`, `oidcClientId`, `oidcClientSecret`) already
  existed from the 3y-4 migration and are now wired. `BuyerOrgMember` gains
  `deactivatedAt DateTime?` (SCIM soft-deprovision; order history preserved).
  Migration `20260706000000_add_oidc_scim_fields`. (Note: the chip brief
  assumed the SCIM columns already shipped in 3y-4; they did not, so this
  round adds them.)
- **OIDC callback (C1).** `GET /api/auth/sso/oidc/[orgId]/callback`: validates
  the signed state (a 10-min HS256 JWT carrying orgId + nonce, no server-side
  session store), exchanges the code, verifies the ID token, enforces the
  domain allowlist, JIT-provisions through the shared
  `provisionResolvedSsoUser` path (extracted in `src/lib/sso.ts` so SAML and
  OIDC share the User + BuyerOrgMember upsert + domain auto-join), records the
  SsoLoginEvent, and opens a session capped by `sessionMaxAgeMin`.
  `/api/auth/sso/initiate` now routes to the OIDC `/authorize` URL when the
  org's `idpType` is OIDC, else builds the SAML AuthnRequest as before.
  `src/lib/oidc.ts` holds discovery (cached 10 min), JWKS caching, state
  sign/verify, authorize-URL builder, and code exchange.
- **SCIM 2.0 (C2).** `/api/scim/v2/[orgId]/Users` GET (list + `userName eq`
  filter that Okta calls on every login, paginated), POST (create -> User +
  BuyerOrgMember at `defaultRole`, 409 on an already-provisioned member).
  `/Users/[id]` GET, PATCH (`active:false` soft-deactivates + bumps
  `sessionsValidFrom`; `active:true` reactivates), PUT (name update +
  active), DELETE (soft-deactivate, never hard-delete: order history). Bearer
  token check is `sha256(token)` constant-time compared against
  `scimTokenHash`, gated on `scimEnabled`; 401 on any mismatch.
  `/ServiceProviderConfig` discovery doc and read-only `/Groups` (the four
  org roles with members, for IdP debugging; the IdP cannot edit roles).
  New `scim` rate-limit bucket at 600/min/org (Okta initial-sync burst).
  `src/lib/scim.ts` holds token gen/hash/compare, the SCIM resource mapping,
  filter + PATCH parsing, and the (de)activate helpers.
- **SCIM token issuance + cert rotation + SLO (C3).** Shared action dispatcher
  `src/lib/sso-actions.ts` backs both `/api/buyer-org/sso/actions` (org admin,
  active-org scoped) and `/api/admin/buyer-orgs/[id]/sso/actions` (site admin,
  path scoped): `scim-rotate` (token shown exactly once, regenerate
  invalidates the old), `scim-disable`, `cert-stage` (save a next signing cert
  without touching current), `cert-activate` (promote staged to current, clear
  staging). The ACS already accepted either current or next cert from 3y-4
  (`buildSaml` passes both to node-saml), so staging is zero-downtime.
  `POST /api/auth/sso/slo/[orgId]` destroys the caller's own session, audits
  `SSO_LOGOUT`, and best-effort redirects to the IdP logout (SAML `idpSloUrl`
  or OIDC `end_session_endpoint`). `SsoConfigForm` gains an IdP-type selector,
  OIDC fields (issuer / client id / secret, plus the redirect URI to copy), a
  SCIM token panel, and the cert rotation stage/activate UI. A routine config
  save no longer clobbers a staged next cert (the save path only touches
  `idpX509CertNext` when the key is explicitly sent; staging is owned by the
  action route).

New audit actions in PLH-3y-5: `SSO_DEPROVISIONED`, `SCIM_USER_PROVISIONED`,
`SCIM_USER_UPDATED`, `SCIM_TOKEN_ROTATED`, `SSO_CERT_STAGED`,
`SSO_CERT_ACTIVATED`, `SSO_LOGOUT`.

Owner setup to test OIDC end to end (config is per-org in the DB, no env vars):
open `/buyer-org/sso` (org admin) or `/admin/buyer-orgs/[id]/sso` (site admin),
switch Protocol to OIDC, copy the displayed Redirect URI into a new OIDC web
app at the IdP (Google Cloud Console OAuth client, or an Okta/Azure OIDC app),
paste the Issuer URL, Client ID, and Client secret back, set the domain
allowlist, Save. Then visit
`/api/auth/sso/initiate?orgId=<orgId>` (or `?email=<you@allowed-domain>`) to
round-trip a Google/Okta/Azure login.

Owner setup to test SCIM (Okta example): after SSO is configured, click
Generate SCIM token, copy the token (shown once). In Okta -> the app ->
Provisioning -> Integration, set SCIM base URL to the displayed
`/api/scim/v2/<orgId>` and the bearer token, enable Create/Update/Deactivate.
Okta test-credentials calls `GET /ServiceProviderConfig` then
`GET /Users?filter=userName eq "..."`; assigning/unassigning a user drives
POST and PATCH active=false.

Security caveats worth a careful smoke test: (1) an OIDC ID token with a bad
signature, wrong audience, expired exp, or mismatched nonce must be rejected
(lands FAILED_SIG in SsoLoginEvent, no session); (2) a SCIM request with a
wrong/blank bearer token must 401, and the compare is constant-time on the
hash; (3) deactivate (PATCH active=false / DELETE) must bump
`sessionsValidFrom` so the user's live cookies die immediately, while order
history rows survive; (4) confirm a routine SSO config save does not wipe a
staged rotation cert.

Deviations: (1) the OIDC library is `jose`, not the spec's `openid-client`
(rationale above; both are vetted, jose avoids the extra dependency). (2) The
optional `/api/cron/sso-session-refresh` introspection cron (for OIDC refresh
tokens when `honorIdpSessionExpiry`) is out of scope this round; SAML has no
introspection and OIDC sessions rely on `sessionMaxAgeMin` + SCIM deprovision,
matching the SAML posture. (3) A SCIM-deprovisioned member who later completes
a fresh SSO login is not auto-reactivated by the login path; reactivation is
SCIM-driven (PATCH active=true). (4) Org-admin SSO actions live under
`/api/buyer-org/sso/actions` (active-org context) to match the rest of the
`/buyer-org` surface rather than a `[id]`-scoped path.

Locked decisions honored: generic OIDC (no vendor code), SSO + SCIM free (no
tax tier), SCIM tokens shown once and stored hashed. No new dependencies (jose
was already present). No new crons. Migration
`20260706000000_add_oidc_scim_fields`. Round 5 of 6; approvals (PLH-3y-6) is
the final round.

## PLH-3y-6: Approval workflows (round 6 of 6, EPIC COMPLETE)

Final round of the SSO + buyer-orgs + approvals initiative. Lands order
approval workflows for buyer organizations. 6 commits, each `npx next build`
clean, zero em dashes.

- **C1 (prerequisite)**: `Order.buyerOrgId String?` column set at order
  creation from the buyer's active org context. Indexed. Spend-visibility
  filter in `/api/account/orders` updated to OR `buyerOrgId = org.id` (for
  new orders) with the membership-based fallback (legacy orders). Migration
  `20260707000000_add_order_buyer_org_id`.

- **C2 (schema + engine)**: Migration
  `20260708000000_add_approval_workflows` adds `Order.approvalStatus`
  (default NONE), `Order.approvedByMemberId`, `BuyerOrgMember.oooUntil`,
  `BuyerOrgMember.delegateToMemberId`, `ApprovalRule` table, `OrderApproval`
  table. `src/lib/approval.ts`: `evaluateAndApplyApproval` (best-effort,
  returns NONE/PENDING/AUTO_APPROVED; non-org buyers and org buyers with no
  matching rules are completely unaffected) + `advanceApproval` (OOO-aware
  chain with admin short-circuit). POST `/api/orders` and
  `/api/checkout-from-quote/[id]` call `evaluateAndApplyApproval` after
  order creation and return `pendingApproval: true` when PENDING.
  POST `/api/payments/create-session` rejects PENDING and REJECTED orders
  with `APPROVAL_PENDING` / `APPROVAL_REJECTED` error codes.
  `canApproveOrders` + `canManageApprovalRules` helpers added.
  12 approval audit actions registered.

- **C3 (approver pages)**: GET `/api/buyer-org/approvals` (paginated queue
  by status), POST `/api/buyer-org/approvals/[orderId]/decide` (single
  approve/reject), POST `/api/buyer-org/approvals/bulk` (up to 50 orders
  in one call). `/buyer-org/approvals` page gated to ADMIN/APPROVER.
  `ApprovalsClient`: tabbed PENDING/APPROVED/REJECTED queue, per-row
  approve/reject actions, bulk-select checkbox (ADMIN only), reject modal.
  `/orders/[id]` approval status banners (PENDING: awaiting approver with
  Remind + Emergency bypass inline buttons; REJECTED: reason shown).

- **C4 (one-click email approve)**: `src/lib/approval-token.ts`: signed
  HMAC tokens for one-click approve/reject URLs (same pattern as
  `order-link.ts`). GET `/api/approval/decide`: verifies token, approves
  directly or redirects to `/approval/reject/[token]` page for rejection.
  POST `/api/approval/decide`: reads `body.reason` and calls
  `advanceApproval`. 5 notification emails: `sendApprovalRequested` (fired
  on step creation), `sendApprovalApproved` / `sendApprovalRejected` (fired
  on decision), `sendApprovalEscalated`, `sendApprovalBypassed`.

- **C5 (crons + safety)**: `/api/cron/approval-escalate`: escalates
  PENDING steps past `escalateAfterHours` to `escalateToMemberId`, audits
  `APPROVAL_ESCALATED`. Scheduled twice at 8:00 + 8:30 UTC.
  `/api/cron/approval-orphan-sweep`: reassigns steps with no approver
  after 48h to org ADMIN, audits `APPROVAL_ORPHANED_REASSIGNED`. Scheduled
  7:30 UTC. POST `/api/approval/bypass`: site-admin emergency bypass, sets
  `approvalStatus=BYPASSED`, audits `EMERGENCY_APPROVAL_BYPASS`. POST
  `/api/approval/poke`: buyer re-notifies approver (rate-limited 1/24h/order).
  PATCH `/api/buyer-org/member/ooo`: member sets/clears OOO delegation.

- **C6 (SLA dashboard + rule CRUD)**: `/buyer-org/approvals/dashboard`:
  pending count, avg age, oldest pending age, pending value, 7-day
  approved/rejected counts. `/buyer-org/approval-rules`: ADMIN-only rule
  CRUD page with `ApprovalRulesClient` form. Rule API:
  GET/POST `/api/buyer-org/approval-rules`,
  PATCH/DELETE `/api/buyer-org/approval-rules/[id]`. All mutations audit
  `APPROVAL_RULE_CREATED/UPDATED/DELETED`. Buyer-org home page gains
  Approvals + Approval rules nav links (role-gated).

Locked decisions honored: approvalStatus=NONE default so non-org and
no-rule orders are completely unaffected; evaluateAndApplyApproval is
best-effort and never throws into order creation; BYPASSED state allowed
through to payment.

New cron entries in vercel.json: approval-escalate x2 (8:00 + 8:30 UTC),
approval-orphan-sweep (7:30 UTC).

Migrations: `20260707000000_add_order_buyer_org_id`,
`20260708000000_add_approval_workflows`.

**THE SSO + BUYER-ORGS + APPROVALS EPIC (PLH-3y) IS NOW COMPLETE (6 of 6).**

**PLH-3z-1 (2026-05-28). Net-terms invoice plumbing. Round 1 of 4 of the
net-30 epic (full spec at docs/PLH-3z-spec-net30-ar.md). 1 commit (6779f63).**
- `PaymentTerms` enum (PREPAID default, NET_15/30/60). `InvoiceStatus` extended
  with DUE + PAST_DUE. `BuyerOrg.paymentTerms` + `creditLimitCents`,
  `Order.paymentTerms` + `invoiceDueDate`. Migration
  `20260709000000_add_net_terms`.
- Order creation snapshots the active org's terms onto the order. Non-PREPAID
  orgs place invoice orders: status PENDING, no Stripe Checkout, invoiceDueDate
  = order date + terms days, a DUE invoice generated at order time via
  `ensureNetTermsInvoiceForOrder`, `sendInvoiceIssued` emails the hosted
  invoice link (no PDF attach; no PDF renderer in the tree). Response carries
  `invoiceOrder: true` so the client skips the payment step.
- PREPAID orgs and non-org buyers are 100% unchanged (existing Stripe checkout).
- Site admin sets terms + manual credit limit on `/admin/buyer-orgs/[id]` via
  the new `OrgTermsEditor` + `/api/admin/buyer-orgs/[id]/terms` PATCH.
- Audit `BUYER_ORG_TERMS_UPDATED`.
- Deferred to later rounds: Stripe Invoices + ACH (3z-2), credit application +
  A/R dashboard (3z-3), dunning + auto-suspend + payout policy (3z-4).
- Built by the orchestrator directly (build chips were hitting transient
  "Invalid request" API errors from oversized reads on the now-large codebase).
- `npx next build` clean. Zero em dashes.
