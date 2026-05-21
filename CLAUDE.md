# PartsPort — project context

Working brief for anyone (human or AI) continuing this project. Read this first.

## What it is
A full-stack online marketplace for **energy & utilities equipment** — transformers,
switchgear, protective relays, conductors, metering, generators, solar, storage,
grounding, SCADA. Buyers search or describe what they need, compare vetted-supplier
options, and order. PartsPort takes a small transaction fee and handles payment +
delivery.

## Business model (decided — do not re-litigate)
- Three parties: **manufacturers (OEMs)** build equipment → **distributors** stock and
  sell it → **buyers** (utilities, co-ops, contractors, EPCs) need it.
- **OEMs participate free** (storefront + demand visibility, no channel conflict — every
  sale routes to their authorized distributors).
- **Distributors pay the transaction fee** (4%) on orders that settle on-platform.
- **Two purchasing lanes:** instant checkout for in-stock items; an **RFQ / "Request a
  quote"** flow for big-ticket configured equipment (≥ $3,000) — the accepted quote
  becomes an on-platform order so the transaction/fee always settles here.
- Energy & utilities is the **starting vertical**; the catalog is category-agnostic and
  meant to expand to other industries later.

## Status
- All application code is **complete and tested**. Don't rebuild it.
- **Pending:** the live deploy. The Vercel project `rok-preview` is connected to GitHub,
  but a **Postgres database must be connected in the Vercel dashboard** (Storage → Neon)
  or the build fails. This needs browser access to Vercel — see `README.md`.
- **Pending:** real product photography (owner is supplying). Each product supports an
  `imageUrl`; suppliers add photo URLs from the dashboard. There's a line-art fallback.
- Possible future: a more cinematic, full-bleed landing page once photography exists.
  The catalog/checkout/dashboards should stay clean functional tools, not a showcase.

## Repo
- GitHub `AgentRad/rok-preview`, branch `claude/industrial-marketplace-ROwAU`, PR #1.
- `master` is the old static "Ring of Keys" site this project replaced.

## Stack & architecture
- Next.js 15 (App Router) + TypeScript, Prisma ORM, PostgreSQL.
- Auth: hand-rolled cookie sessions (JWT via `jose`, bcrypt) — roles BUYER / SUPPLIER / ADMIN.
- Payments: PayPal sandbox when env keys are set; built-in demo checkout otherwise.
- Search: Anthropic API (`claude-opus-4-7`) for natural-language catalog search when
  `ANTHROPIC_API_KEY` is set; heuristic keyword fallback otherwise. See `src/lib/search.ts`.
- Key dirs: `src/app` (pages + `api` routes), `src/components`, `src/lib`, `prisma`.
- Data model (`prisma/schema.prisma`): User, Supplier, Product, Order, OrderItem,
  SupplierApplication, QuoteRequest.

## Conventions
- Design system in `src/app/globals.css`: editorial / industrial — warm off-white,
  hairline borders, Hanken Grotesk (light display weights) + IBM Plex Mono (labels),
  near-black primary buttons, amber accent. Keep new UI consistent with it.
- Product illustrations are line-art SVGs in `src/components/PartIcon.tsx` (fallback for
  missing photos).
- Catalog content (suppliers, products) is seeded from `prisma/seed.mjs` — idempotent
  and non-destructive.

## Run locally
See `README.md`. In short: needs Postgres; `npm install`, set `.env` (`DATABASE_URL` +
`DATABASE_URL_UNPOOLED`), `npx prisma migrate deploy`, `node prisma/seed.mjs`, `npm run dev`.

## Demo accounts
Password `demo1234`: `buyer@partsport.example`, `supplier@partsport.example`,
`admin@partsport.example`.

## Environment variables
`DATABASE_URL` + `DATABASE_URL_UNPOOLED` (required). Optional: `ANTHROPIC_API_KEY`,
`PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` / `NEXT_PUBLIC_PAYPAL_CLIENT_ID`,
`SESSION_SECRET`. The build runs `prisma migrate deploy` + seed, so deploys come up
populated.
