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

## Status (updated 2026-05-26, post P11.10)
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

**Next up after PLH-1: real-world verification + production cutover.** No
more code-side polish rounds planned. See ship-ready playbook in
`LAUNCH_PLAN.md`.

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
  `/api/stripe/webhook` — the route lives under the processor-agnostic
  `/api/payments/*` namespace).
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

## Doc maintenance (STANDING RULE for every chat)
After any work is shipped AND verified by Rad in chat (he confirms it works,
posts a passing PSI score, or otherwise OKs the result), update the relevant
MD files in the SAME branch before moving on:

- **CLAUDE.md** — update the Status section whenever a polish round, fix
  round, or major feature ships. Include final state (scores, bundle size,
  what shipped, what's pending). This is the single source of truth for
  future chats about where the project is.
- **docs/ORCHESTRATOR.md** — mark roadmap items DONE when they close.
  Add new rounds when planned. Do not let it diverge from reality.
- **LAUNCH_PLAN.md** — update when a business decision changes (fee rate,
  vertical scope, processor choice, etc.).

Do NOT update docs prematurely. Update only after Rad has confirmed the
work passes in-chat. If a round is partially shipped (some items skipped),
note skipped items and why in the doc so future chats can see the trail.

The point: every fresh chat that opens this repo should be able to read
CLAUDE.md + docs/ORCHESTRATOR.md and immediately know the real state
without needing Rad to re-brief them.

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
