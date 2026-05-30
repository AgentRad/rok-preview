# PartsPort

An online marketplace for **energy &amp; utilities equipment** — transformers, switchgear,
protective relays, conductors, metering, generators, solar, storage, grounding, and
SCADA. Buyers search (or describe) what they need, compare vetted-supplier options,
and order; PartsPort handles payment and delivery and takes a small transaction fee.

Full-stack **Next.js 15** + **Prisma** + **PostgreSQL**.

---

## Deploy a live preview (Vercel + Neon)

The app needs a Postgres database. The fastest path — about 90 seconds:

1. Open **vercel.com** → the **rok-preview** project.
2. **Storage** tab → **Create Database** → choose **Neon** (Postgres) → **Create**.
3. When prompted, **Connect** the database to the project (all environments).
   Vercel sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED` automatically.
4. **Deployments** tab → newest `claude/industrial-marketplace-ROwAU` build → **Redeploy**.

The build runs database migrations and seeds the catalog automatically, so the site
comes up fully populated. The branch deployment's URL is your shareable preview.

Optional environment variables (Settings → Environment Variables):

| Variable | Purpose | If unset |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | AI natural-language catalog search | Falls back to keyword search |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` / `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | Real PayPal sandbox checkout | Built-in demo checkout is used |
| `SESSION_SECRET` | Signs login sessions | Insecure dev fallback (set one for production) |

---

## Run locally

```bash
git clone https://github.com/AgentRad/rok-preview.git
cd rok-preview
git checkout claude/industrial-marketplace-ROwAU
npm install
cp .env.example .env          # fill in DATABASE_URL + DATABASE_URL_UNPOOLED
npx prisma migrate deploy     # create the tables
node prisma/seed.mjs          # load the catalog
npm run dev                   # http://localhost:3000
```

You need a Postgres database — a free Neon project works; point both `DATABASE_URL`
and `DATABASE_URL_UNPOOLED` at it (locally they can be the same string).

## Demo accounts

Password `demo1234` for all three:

| Role | Email |
| --- | --- |
| Buyer | `buyer@partsport.example` |
| Supplier | `supplier@partsport.example` |
| Admin | `admin@partsport.example` |
| Manufacturer (OEM) | `oem@partsport.example` |

---

## What's inside

- **Storefront** — catalog, AI-assisted search, product pages, cart, checkout.
- **Two purchasing lanes** — instant checkout for in-stock items; an RFQ
  ("Request a quote") flow for big-ticket configured equipment.
- **Supplier dashboard** — listings, stock and pricing, quote requests, order
  fulfillment.
- **Admin console** — GMV and fee metrics, supplier-application review, orders,
  quotes.
- **Marketing** — `/how-it-works` and `/manufacturers` explain the model for
  buyers, distributors, and OEMs.

## Tech

Next.js 15 (App Router) · TypeScript · Prisma ORM · PostgreSQL · cookie-session
auth with bcrypt · PayPal · Anthropic API for search · deploys on Vercel.
