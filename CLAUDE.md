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
- **Distributors pay the transaction fee** (4%) on orders that settle on-platform.
- **Two purchasing lanes:** instant checkout for in-stock items; an **RFQ / "Request a
  quote"** flow for big-ticket configured equipment (>= $3,000). The accepted quote
  becomes an on-platform order so the transaction/fee always settles here.
- Energy & utilities is the **starting vertical**; the catalog is category-agnostic and
  meant to expand to other industries later.

## Status (updated 2026-05-21)
The app is **deployed and live**. Core buy-loop works: catalog, AI + heuristic search,
product pages, cart, checkout, orders, buyer/supplier/admin/OEM dashboards, RFQ flow,
fulfillment ops console.

Live preview URL:
https://rok-preview-git-claude-industrial-marketplace-rowau-agentrad.vercel.app

Infrastructure set up and working:
- Vercel project `rok-preview`. Framework Preset = Next.js. Deployment Protection OFF
  (publicly viewable). Production slot still points at `master`; PartsPort serves from
  the branch below.
- Neon Postgres database connected (`partsport-db`, Free plan). Build auto-runs
  migrations + seed.
- Next.js pinned to 15.2.6 (patched for the react2shell CVE).
- Email: Resend account; domain `partsport.agentgaming.gg` verified (DKIM/SPF/MX live
  on Cloudflare DNS). `RESEND_API_KEY` is set in Vercel. Sending CODE is not built yet
  (Phase E below).
- AI search is live (`ANTHROPIC_API_KEY` set; small pay-as-you-go cost per search).

Pending: real product photography (owner supplying; line-art fallback exists). A custom
web domain is optional; the project currently uses the vercel.app preview URL.

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
