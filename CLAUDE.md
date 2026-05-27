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
P12 has compiled clean. Zero em dashes throughout.

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

- **Single-supplier carts.** A buyer's cart can only contain items from one
  supplier. PartsPort routes shipments and payments per supplier; the
  multi-shipment freight split exists in code but the Order model is still
  one-supplier-per-order. Enforced in `src/lib/cart.ts` (client) and
  `src/app/api/orders/route.ts` POST (server). UI prompt: "Your cart
  contains items from <supplier>. Start a new cart?" The full
  multi-supplier Shipment refactor (one Order, N Shipments, per-supplier
  payment intent splits via Stripe Connect destination charges) is queued
  for post-launch.

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
