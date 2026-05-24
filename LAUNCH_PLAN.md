# PartsPort: Launch Plan and Build Spec

The single document that captures everything that needs to happen to get PartsPort built and to market. Read top to bottom. Nothing here is optional unless flagged as deferred. No em dashes anywhere in the platform copy.

---

## 1. What PartsPort is

A transactional online marketplace for industrial and utility equipment. Buyers search or describe what they need in plain language, compare vetted-supplier options at a glance (photo, manufacturer, price, rating, delivery ETA), and order. PartsPort handles discovery, vetting, payment, and delivery, and takes a transaction fee. Starting vertical is energy and utilities; the catalog is category-agnostic and built to expand.

## 2. The three parties

1. **Manufacturers (OEMs)** design and build equipment. Free participation. Branded storefront, demand intelligence, no channel conflict. Every sale routes to their authorized distributors. OEMs never sell direct.
2. **Distributors (suppliers)** stock and sell. They list products, fulfill orders, and pay the transaction fee.
3. **Buyers** (utilities, co-ops, municipals, contractors, EPCs) need the equipment.

## 3. The model

- Buyer pays: subtotal (part price) + freight + platform fee + sales tax.
- Supplier receives: full subtotal on dispatch (on cleared funds).
- Carrier receives: freight.
- State receives: sales tax (pass-through, never revenue).
- PartsPort keeps: the fee. Recommended fee 5 to 6 percent. The rate must be a single configurable value, never hardcoded.
- Payment rails priority: ACH bank transfer default, wire for large orders, card secondary. ACH/wire is where margin lives.

Two purchasing lanes:
- **Instant checkout** for in-stock items.
- **RFQ (request a quote)** for big configured equipment, typically over about $3,000. Accepted quote becomes an on-platform order so the fee always settles here.

## 4. The nine categories of the platform

1. **Catalog & Search.** Supplier listings, AI natural-language search, browse and filter.
2. **Buying.** Instant checkout lane and RFQ/quote lane.
3. **Payments & Pricing.** Processor-agnostic payments (ACH/wire default), the fee, freight line, sales tax.
4. **Invoicing & Documents.** Invoices, quotes, packing slips, bills of lading. Excel import/export. AI import assistant. Document storage.
5. **Fulfillment & Delivery.** Booking freight, carriers, tracking, ops console, claims.
6. **Money to Suppliers.** Payouts on dispatch, accounting, QuickBooks export, 1099s.
7. **Communication.** Transactional email, in-platform messaging threads (email-connected), notifications.
8. **Trust & Verification.** Supplier vetting, OEM brand protection (authorized-distributor only), reviews and ratings.
9. **The Business Layer.** Legal entity, insurance, sales-tax registration, carrier contracts, lawyer-drafted documents, working capital. Non-software, only the founder can do these.

---

## 5. What is already built

Do not rebuild any of this.

- Catalog with category filter, in-stock filter, sort (price, ETA, rating).
- AI and heuristic search.
- Product detail pages, single image with line-art fallback, specs, buybox.
- Cart, checkout, order creation, demo and PayPal-sandbox payment.
- Order detail page, buyer order history (`/account`).
- Auth with four roles: BUYER, SUPPLIER, ADMIN, MANUFACTURER. Register, login.
- Supplier dashboard (`/supplier`) with listing, stock, price management.
- Admin console (`/admin`): GMV, fees, supplier-application review, orders, quotes.
- OEM/manufacturer dashboard (`/oem`): demand intelligence from logged searches.
- RFQ/quote flow end to end.
- Fulfillment ops console (`/ops`): paid orders through New, Processing, Shipped, Delivered with carrier and tracking capture.
- Marketing pages: landing (live search hero), `/how-it-works`, `/suppliers` (with benefits grid), `/manufacturers`.

---

## 6. What is missing and must be built (the gap list)

1. No email or notifications anywhere.
2. No invoicing.
3. No real payment processor. PayPal sandbox only. No Stripe, no card, no ACH.
4. No supplier payouts.
5. No product reviews.
6. Buyer cannot see shipment tracking.
7. No saved addresses.
8. No password reset.
9. No order cancellation or refund flow for buyers.
10. No returns or RMA flow.
11. No multi-image product galleries.
12. No catalog pagination, no brand/manufacturer filter.
13. No related products, no reorder.
14. No real product photography (line-art fallback exists).
15. No rate limiting or abuse protection on auth and search.
16. No per-page SEO metadata.

---

## 7. The build plan (in order)

Build, test against local Postgres, `npx next build` must pass, then commit and push per phase. Match the editorial design system. **Zero em dashes in copy.**

### Phase A: Invoicing and documents (no external account needed)

- Add `Invoice` Prisma model: `number` unique = `INV-<orderRef>`, `orderId` unique, `status` ISSUED/PAID/VOID, `issuedAt`, snapshot `subtotalCents`, `freightCents`, `taxCents`, `feeCents`, `totalCents`.
- Generate the invoice inside `markOrderPaid()` in `src/lib/order-utils.ts` (idempotent).
- Build a print-styled invoice page at `src/app/orders/[id]/invoice/page.tsx`, buyer and admin only, with a `window.print()` button and `@media print` CSS.
- Consolidated invoicing: one invoice per buyer order even when items span multiple suppliers.
- List invoices in `/admin`.
- Generate as PDF (now or shortly after): invoice, RFQ quote, packing slip, bill of lading for LTL freight orders.
- Document storage and upload: tax-exemption certificates, supplier insurance certificates, supplier verification documents, OEM datasheets attached to products.

### Phase B: Buyer order tracking

- On `src/app/orders/[id]/page.tsx`, show a status timeline: Paid, Processing, Shipped, Delivered.
- Surface `carrier` and `trackingCode` to the buyer.

### Phase C: Email-connected messaging

- One messaging system. In-platform threads tied to each RFQ and each order, between buyer and supplier, visible to admin.
- Email-connected: a thread message is also delivered as email to the other party, and a reply by email is parsed back into the thread.
- Notifications center in-app.

### Phase D: Product reviews

- Add `Review` model: buyer, product, supplier, rating 1 to 5, body, createdAt.
- Only buyers with a verified delivered order for that product can post a review.
- Show real reviews and computed averages on the product page; replace static `Supplier.reviews` with real counts.

### Phase E: Saved addresses

- Add `Address` model linked to User.
- Address book on `/account`. Checkout picks a saved address or adds a new one.

### Phase F: Transactional email and password reset (needs an email provider)

- `npm i resend` (or equivalent). Gate on `RESEND_API_KEY` like PayPal is gated; no-op when absent so builds never break.
- Send: order confirmation, payment received, order shipped (with tracking), delivered, RFQ received, quote ready, supplier-application status, password reset, payout sent.
- Add a password-reset flow: `PasswordResetToken` model, request and reset pages.

### Phase G: Payments, processor-agnostic, ACH/wire first (needs a processor account)

- Build the payment integration behind an abstraction layer so the processor is swappable. Do not hard-wire any processor.
- Rails priority: ACH bank transfer default, wire for large orders, card secondary.
- Use hosted checkout pattern (Stripe Checkout Session or equivalent). Enable card and ACH (`us_bank_account`).
- Routes: `/api/payments/create-session`, `/api/payments/webhook` (verify signature, raw body, `runtime = "nodejs"`; on success call `markOrderPaid(orderId, "<processor>", sessionId)`).
- Gate on the processor secret env var. Keep demo fallback when absent.
- Wire into instant checkout AND accepted-RFQ order payment.
- **Payment-state-gated order lifecycle:** nothing dispatches and no payout is created until funds are CLEARED (settled), not merely submitted. Account for the ACH return window. Wire is final on receipt.

### Phase H: Supplier payouts

- Add `Payout` model: supplierId, orderId, amountCents (that supplier's share of subtotal), status DUE/PAID, createdAt, paidAt.
- Create `Payout` rows when an order is dispatched. One per supplier per order.
- Supplier dashboard `/supplier`: "Payouts" section showing Due and Paid totals and per-order rows.
- Admin `/ops`: "Payouts owed" view with a Mark Paid action.

### Phase I: AI import assistant and Excel

- Excel/CSV: supplier bulk catalog upload, buyer BOM upload matched to catalog, exports of orders, invoices, payouts in CSV including a QuickBooks-ready format.
- AI import assistant: a guided, bounded assistant that helps a supplier map a messy spreadsheet to the PartsPort product schema and resolve ambiguities conversationally. Not an open-ended chatbot.
- Human review and explicit approval before any data goes live. AI never silently changes a price or a spec.

### Phase J: Catalog at scale

- Add pagination to `/catalog`.
- Add a brand/manufacturer filter facet.

### Phase K: Returns, RMA, cancellation

- Add a `ReturnRequest` model.
- Buyer-initiated cancellation for unfulfilled orders.
- Time-limited damage/defect claim window after delivery.
- Supplier condition record (photos, serial number, optional test report) captured before dispatch.
- Buyer inspection-on-delivery step noted on the freight delivery receipt.
- Admin handling and refund/clawback workflow.

### Phase L: Multi-image product galleries

- Replace `Product.imageUrl` with a `ProductImage` model (ordered images).
- Carousel on the product page. Suppliers manage multiple images.

### Phase M: QuickBooks

- Do NOT build full OAuth sync.
- Add `/api/admin/invoices.csv` (admin-only) returning all invoices as CSV with QuickBooks-importable columns (Invoice No, Customer, Date, Item, Qty, Rate, Amount, Status).
- Add an "Export for QuickBooks" link on the admin invoices view.

### Cross-cutting requirements

- **Pricing has four components everywhere:** subtotal, freight, platform fee, sales tax. Order model gets `freightCents` and `taxCents`. Every breakdown (checkout, invoice, RFQ quote) shows all four.
- **Sales tax:** integrate Stripe Tax or equivalent. Pass-through, never revenue. Capture and store tax-exemption certificates; exempt buyers are not charged tax.
- **Fee rate:** single configurable value. When the owner confirms moving from 4 percent to 5 to 6 percent, update all "4%" copy site-wide.
- **Permissions, future-proof:** design role/permissions so OEM-tier content can be gated per-OEM (only Brand X's authorized distributors access Brand X) later. Do NOT build the wholesale tier now. Brand names on the retail catalog stay public.
- **Fraud and verification:**
  - Progressive onboarding. Minimum to start, full profile (tax ID, banking, insurance, W-9) required before first transaction/payout.
  - KYC and bank-account verification at supplier onboarding.
  - Re-verify any time a supplier changes payout bank details.
  - No payout until verified proof of dispatch.
  - Anomaly and velocity checks. Human review on high-value orders.

---

## 8. Business layer tasks (only the founder can do)

The platform is built gated on env vars so the absence of these never breaks the build. As each piece becomes available, add the credentials in Vercel and locally.

| Task | Status | Notes |
|---|---|---|
| Legal entity, EIN, business bank account | Done (per owner) | |
| Insurance (general liability, product liability, cargo/transit) | In progress (per owner) | |
| Domain purchase and DNS | To do | Point at Vercel. |
| Vercel: confirm Neon Postgres connected | Verify | Storage tab. |
| Vercel env vars | Add as available | `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY` (or chosen processor), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `SESSION_SECRET`. |
| Payment processor account | To do | Whichever processor; ACH/wire support, marketplace split, KYC. Test mode keys + webhook secret. |
| Email provider (Resend or similar) + verified sending domain | To do | Add DNS records at the registrar. |
| Carrier or freight-broker accounts | To do | Parcel (FedEx/UPS) + an LTL carrier or broker. For first ~20 orders book by hand (concierge). |
| Sales-tax registration | To do | Where nexus exists. Get a tax professional; do not wing it. |
| Lawyer-drafted documents | To do | Supplier agreement (fee, payout-on-dispatch, packing standard, condition record), buyer terms of service (inspection-on-delivery obligation, claim window), returns/claims/warranty policy, privacy policy. Real lawyer, not a template. |
| Working capital (for the float) | Later | Pay suppliers on dispatch even before buyer ACH fully clears. Trivial at pilot scale; real capital line at volume. |
| Real product photography | Ongoing | Owner is supplying. Line-art fallback handles the gap. |
| QuickBooks (full sync) | Deferred | CSV export bridges the gap until later. |

---

## 9. The pilot plan (first real test orders)

The platform exists to prove the loop with real money and real parts. The pilot is how you validate.

- **Use two companies you know.** Ideally one supplier (distributor) and one buyer. If both are the same type, bring the other side.
- **Order #1 must be the easiest possible transaction.** Simple, in-stock, parcel-shippable item on the instant-checkout lane. Not a $40,000 transformer through RFQ with LTL freight on the first try. Isolate variables.
- **Run the whole loop for real:**
  1. Supplier lists the real product at a real price.
  2. Buyer finds and orders it.
  3. Real money moves (ACH).
  4. You book freight by hand (concierge).
  5. Carrier and tracking captured. Buyer sees status.
  6. Delivered, supplier paid, invoice generated.
- **Sit with both companies as they go through it.** Every hesitation is product feedback worth more than the order itself.
- **Sequence subsequent orders:** #2 an RFQ, #3 a freight-heavy item. Test every lane over the first handful of orders.
- **Success = repeat intent.** "Would you do the next one here." If yes, do ten more. If not, diagnose: software bug, process gap, or they did not actually want it.

**Must-haves before order #1:** the order loop, real payment (ACH), invoicing with freight + tax lines, buyer-visible tracking. Messaging, the AI import assistant, QuickBooks export, reviews, multi-image galleries can come after. Do not block order #1 on the full build.

---

## 10. Operating principles

- **Build everything to function for real.** Nothing stubbed, nothing faked.
- **Asset-light logistics.** No owned warehouses or trucks. Carriers and 3PLs are the physical layer; PartsPort orchestrates.
- **AI for volume, humans for judgment.** AI handles search, document parsing, catalog cleanup, RFQ triage. Humans handle vetting, business development, logistics exceptions, support, dispute resolution.
- **Make the platform more valuable than bypassing it.** Anti-disintermediation is built into every category: guaranteed fast payment, managed fulfillment, consolidated invoicing, system of record, steady demand, future net terms. Plus a fair contract clause: orders from a PartsPort-introduced buyer route through the platform for a defined period.
- **Fraud is managed, not eliminated.** Layered defenses; budget for a small loss rate.
- **Damage claims are an evidence chain, not prevention.** Supplier condition record before dispatch, buyer inspection at delivery on the freight receipt, tight claim window.
- **The biggest risk is the cold-start.** The founder's network in energy and utilities is the asset that beats it.

---

## 11. Working conventions

- Branch: `claude/industrial-marketplace-ROwAU`. Only one chat works on the branch at a time. Two agents on one branch causes merge conflicts.
- No em dashes in any copy on the site.
- `npx prisma migrate dev` for every schema change; commit the generated migration.
- `node prisma/seed.mjs` is idempotent.
- `npx next build` must pass before every commit.
- Commit per phase with a clear message. No pull request unless asked.
- Match the editorial design system in `src/app/globals.css`.

---

## 12. Deliverables still to produce

- Pitch deck (when ready, after a pilot order or two).
- Updated full-context handoff file (refresh of this document for the other chat).
- Category 9 protection deep-dive (full liability/legal/insurance walkthrough; deferred per owner).

---

## 13. Done state

PartsPort is done as a launch-ready product when:

- A buyer can search, compare, and order from any vetted supplier with a transparent total (subtotal, freight, fee, tax).
- Payment runs through a real processor over ACH or wire.
- Every paid order produces a viewable, downloadable invoice.
- Every dispatched order produces a buyer-visible tracking timeline and a supplier payout record.
- RFQ flow works end to end and accepted quotes become on-platform orders.
- Suppliers can list, manage stock and pricing, see and respond to RFQs, get paid on cleared dispatch, and export their accounting.
- Manufacturers see real demand intelligence on a free branded storefront.
- Admin and ops can run the marketplace end to end: vetting applications, mediating disputes, exporting invoices for accounting.
- Messaging, notifications, document generation, and trust and verification all function for real.

When this list is true, run the pilot orders, prove repeat intent, then go to market.
