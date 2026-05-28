# PLH-3z spec: enterprise net-30 / A/R

Build-ready spec for replacing instant Stripe checkout with invoice-based
net-X payment terms for enterprise buyer orgs. Layers on top of PLH-3g
(multi-supplier slots), PLH-3i (QuickBooks sync), and the P8/P12 money-ops
infrastructure (3-stage payouts, `owedToPlatformCents` clawback, reserve
transactions, daily crons).

Status: design only. No code changes in this round.

---

## 0. Why this exists

Utilities, co-ops, EPCs, and large contractors do not put six-figure
equipment orders on a credit card. Their AP departments cut a check or wire
funds 30 days after invoice. Today PartsPort forces every buyer through
Stripe Checkout, which means we have been auto-disqualifying our actual
target segment for the energy-and-utilities vertical. PLH-3z makes that
buyer addressable.

The build is non-trivial because the money model inverts: today PartsPort
collects from the buyer before paying the supplier, so reserve + clawback
absorb refund risk. Net-30 means PartsPort either fronts the float to
suppliers (carries A/R risk on the buyer) or makes the supplier wait
30+ days (carries supplier-experience risk). Section 7 + section 9 resolve.

---

## 1. Invoice-instead-of-checkout flow

New buyer-org capability gates checkout into two lanes.

### 1.1 New `BuyerOrg` model

```
model BuyerOrg {
  id                String     @id @default(cuid())
  name              String
  ein               String?
  domain            String?    // optional: auto-attach users with matching email domain
  paymentTerms      PaymentTerms @default(PREPAID)
  creditLimitCents  Int        @default(0)
  paymentDueDay     Int?       // optional: "net 30 from invoice" vs "all unpaid due on the Nth"
  status            String     @default("ACTIVE") // ACTIVE | SUSPENDED
  suspendedAt       DateTime?
  suspendedReason   String?
  createdAt         DateTime   @default(now())
  members           BuyerOrgMember[]
  applications      CreditApplication[]
  orders            Order[]
}

enum PaymentTerms {
  PREPAID
  NET_15
  NET_30
  NET_60
}

model BuyerOrgMember {
  id        String   @id @default(cuid())
  org       BuyerOrg @relation(fields: [orgId], references: [id], onDelete: Cascade)
  orgId     String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId    String
  role      String   @default("MEMBER") // ADMIN | MEMBER
  createdAt DateTime @default(now())
  @@unique([orgId, userId])
}
```

Existing `User` rows gain a nullable `currentBuyerOrgId` (the active org
context at checkout; a user can sit in multiple orgs but only buys for one
at a time, mirroring `getActiveSupplierContext`).

### 1.2 Checkout branching

In `/checkout` (and `/checkout-from-quote/[id]`):

1. Resolve `buyerOrg` from `user.currentBuyerOrgId` (null for personal /
   guest checkout = PREPAID always).
2. If `buyerOrg.paymentTerms === "PREPAID"` or org is null: existing Stripe
   Checkout flow, unchanged.
3. Else: render "Invoice with net-X terms" panel instead of the Stripe
   button. Confirm CTA POSTs to `/api/orders` with `paymentMethod="invoice"`
   and `buyerOrgId` set.

### 1.3 `/api/orders` POST changes

When `paymentMethod === "invoice"`:

- Verify `user` is an ADMIN or MEMBER of `buyerOrg` (server-trusted, not
  client-passed).
- Verify `buyerOrg.status === "ACTIVE"` and `paymentTerms !== "PREPAID"`.
- Compute available credit (section 2.4). Reject 402 if order total would
  exceed it. Error body `{ error: "CREDIT_EXCEEDED", availableCents,
  requestedCents }` so the UI can render a "Contact your AP team" message
  with the right numbers.
- Skip Stripe Checkout session creation entirely. The order moves directly
  to `status="PENDING"` with `paidAt=null`, `paymentMethod="invoice"`,
  `paymentTerms` snapshotted on the order row, `invoiceDueDate` set to
  `createdAt + termsDays`, and `buyerOrgId` set.
- Generate the `Invoice` row immediately (today it is created at
  `markOrderPaid` time). Status `ISSUED` and `dueDate = invoiceDueDate`.
- Fire `sendInvoiceIssued` to the buyer (PDF attachment + ACH/wire
  instructions per section 3).
- Multi-supplier slots: created identically to PLH-3g, slot math
  unchanged. No transfers fire yet (suppliers paid out per section 7).

### 1.4 Existing PREPAID path

Untouched. Stripe Checkout, `markOrderPaid`, slot payouts, all the P8/PLH
infrastructure stays as is. Net-terms is a parallel rail; PREPAID is still
the default and still the only option for personal buyers.

---

## 2. Credit application + approval

### 2.1 Application form

`/account/credit-application` (admin of an existing org) or
`/credit-application` (new prospect, creates the org on approval). Fields:

- Legal company name
- DBA (if any)
- EIN
- Years in business
- Expected monthly spend (cents, ranged dropdown)
- Requested credit limit (cents)
- Requested terms (NET_15 / NET_30 / NET_60)
- Billing address
- AP contact name + email + phone
- 3 trade references (company name, contact, phone, email each)
- W-9 upload (PDF/JPG/PNG, magic-byte sniff, 5 MB cap, private blob like
  PLH-2 4d tax-exempt cert)
- D-U-N-S number (optional)
- Notes / additional context

### 2.2 `CreditApplication` model

```
model CreditApplication {
  id                 String   @id @default(cuid())
  reference          String   @unique // CA-XXXXXX, mirrors RFQ pattern
  org                BuyerOrg? @relation(fields: [orgId], references: [id])
  orgId              String?  // null on initial submit if new prospect
  submittedByUserId  String
  legalName          String
  dba                String?
  ein                String
  yearsInBusiness    Int?
  expectedMonthlyCents Int
  requestedLimitCents Int
  requestedTerms     PaymentTerms
  billingAddress     String
  apContactName      String
  apContactEmail     String
  apContactPhone     String?
  references         Json     // [{ companyName, contact, phone, email }, ...]
  w9BlobUrl          String?  // private blob
  w9BlobAccess       String   @default("private")
  dunsNumber         String?
  notes              String   @default("")
  status             String   @default("PENDING") // PENDING | APPROVED | REJECTED
  reviewedBy         String?
  reviewedAt         DateTime?
  reviewerNote       String   @default("")
  approvedLimitCents Int?     // may differ from requestedLimitCents
  approvedTerms      PaymentTerms?
  createdAt          DateTime @default(now())
}
```

### 2.3 Admin review

`/admin/credit-applications` (table + per-application detail page):

- PENDING-first list with age, requested limit, requested terms,
  expected monthly.
- Detail page renders all fields, audited W-9 download (mirror
  `tax-exempt` private blob download with audit row per fetch), trade
  references, and external lookups (optional D&B link if `dunsNumber` set).
- Approve action requires `approvedLimitCents` and `approvedTerms`
  (admin can downgrade what was requested). On approve inside a single
  `$transaction`:
  1. Upsert `BuyerOrg` (create if `orgId` null).
  2. Set `paymentTerms` + `creditLimitCents` on the org.
  3. Add submitter as `BuyerOrgMember` role ADMIN.
  4. Flip application `status="APPROVED"`, stamp `reviewedBy/At`.
  5. Audit row `CREDIT_APPLICATION_APPROVED`.
  6. Send `sendCreditApplicationApproved` email.
- Reject action requires a reason; same transactional shape, audit
  `CREDIT_APPLICATION_REJECTED`, `sendCreditApplicationRejected` email.
- No auto-approve flag in round 1. Auto-approve is a section-9 decision
  for Conrad; if approved, would be a D&B-score threshold + cap on
  auto-approved limit (e.g. up to $25K limit and NET_30 max, anything
  beyond requires manual review).

### 2.4 Credit limit math

`availableCreditCents(orgId)`:

```
creditLimitCents
  - sum(Invoice.totalCents where order.buyerOrgId=orgId
        and Invoice.status in ('ISSUED','OVERDUE')
        and Invoice.paidAt is null)
  - sum(Order.totalCents where buyerOrgId=orgId
        and status='PENDING' and paymentMethod='invoice'
        and id not in (select orderId from Invoice))   // pending orders mid-create
```

The second subtraction defends a race where two concurrent invoice
checkouts could each individually fit under the limit but sum over it.
Compute inside the `/api/orders` `$transaction` to make the check
serializable; relax later if performance becomes an issue.

---

## 3. ACH / wire payment instructions

Three options. Recommendation up front, then trade-offs.

**Recommendation: Stripe Invoices.** Same payment processor we already use
for Connect, low integration cost, 0.8% capped at $5 per ACH payment is
trivial relative to a $50K invoice, built-in dunning-grade payment links,
chargeback exposure on ACH is structurally lower than on cards (NACHA
returns are limited and time-bounded). The 0.8% can be absorbed by the
existing 6% transaction fee. We get hosted invoice pages, automatic email
reminders we can disable in favor of our own, and webhooks that mirror the
Checkout webhook ergonomics PartsPort already knows.

Option A: PartsPort's own bank (Mercury / BoA / etc.) + manual recon.

- Pros: 0% processing, full control of remittance UX, no third-party
  failure point.
- Cons: manual reconciliation eats admin hours, no payment-link
  affordance, NACHA chargebacks land on us with no merchant-side
  insulation, every late-payer triggers an admin chase. Banks do not give
  per-invoice virtual account numbers unless on a paid treasury tier;
  without those, recon is a fuzzy-match nightmare.

Option B: Stripe Invoices (recommended). Use the Stripe API to create
Invoice + InvoiceItem per PartsPort Invoice row, with `collection_method
= "send_invoice"` so the buyer pays via the hosted Stripe invoice page
(card OR ACH OR wire). Webhook on `invoice.paid` flips our Invoice row.

- Pros: low ops cost, hosted page does the heavy lifting, payment-rail
  agnostic (ACH/wire/card), webhook surface is well-trodden, chargeback
  protection on ACH via Stripe's representment workflow.
- Cons: 0.8% capped $5 per ACH transaction (negligible on enterprise
  tickets), 0.4% wire, cards if buyer pays by card stay at our normal
  card rate (we can disable card by setting `payment_settings.payment_
  method_types = ["us_bank_account"]`). Stripe's 1099-K reporting could
  reshape how we 1099 suppliers; verify against current PLH-3i QBO
  exports before flipping.

Option C: Brex Pay / Coupa Pay / Bill.com.

- Pros: more accounts-payable affordance for buyers (their AP team
  often already lives in Bill.com), better dunning telemetry.
- Cons: third integration to babysit, license cost, slower onboarding,
  duplicates Stripe Invoices' coverage.

**Decision needed (section 9):** Stripe Invoices vs own-bank. Default to
Stripe Invoices; revisit if the 0.8% ever becomes material (it will not
at envisioned ticket sizes).

### Implementation note

If Stripe Invoices: extend `/api/webhooks/stripe` to handle
`invoice.paid` / `invoice.payment_failed` / `invoice.marked_uncollectible`
events. Reuse `markOrderPaid` for the paid case (which already triggers
QBO sync via `after()` per PLH-3i P2). The Stripe Invoice id stores on
PartsPort `Invoice.stripeInvoiceId` (new column).

If own-bank: manual mark-paid lives at section 4 below; no webhook
integration; the admin pastes the reference number from the bank
statement into the form.

---

## 4. Payment recording

Three paths, depending on section-3 outcome.

### 4.1 Stripe Invoices (primary)

`invoice.paid` webhook arrives. Webhook handler:

1. Look up `Invoice` by `stripeInvoiceId`.
2. Inside `$transaction`, flip `Invoice.status="PAID"`, set `paidAt=now`,
   `paidReference=stripeChargeId`, `paymentMethod="ach" | "wire" | "card"`
   (from the Stripe event).
3. Insert `PaymentRecord` row.
4. Call `markOrderPaid(orderId)` which: flips Order to PAID, fires the
   existing P8 3-stage payout flow per supplier slot, fires
   `sendOrderConfirmation`, fires `after()` QBO sync (PLH-3i P2).
5. Audit `INVOICE_PAID_AUTO`.

### 4.2 Manual mark-paid (for off-platform payments)

If a buyer wires direct to PartsPort's bank or pays by check despite
Stripe Invoices being live, admin reconciles at
`/admin/invoices/[id]/record-payment`:

- Form: amount (cents), date received, reference / check #, payment
  method (ACH / wire / check / other), notes.
- POST `/api/admin/invoices/[id]/payments`:
  1. Insert `PaymentRecord`.
  2. If sum(PaymentRecord.amountCents) >= Invoice.totalCents, flip
     Invoice to PAID and call `markOrderPaid`.
  3. Else leave Invoice in ISSUED/OVERDUE with `partialPaidCents`
     incremented (new column on Invoice).
  4. Audit `INVOICE_PAYMENT_RECORDED`.

### 4.3 `PaymentRecord` model

```
model PaymentRecord {
  id            String   @id @default(cuid())
  invoice       Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  invoiceId     String
  amountCents   Int
  receivedAt    DateTime
  method        String   // "ach" | "wire" | "check" | "card" | "other"
  reference     String   @default("")
  source        String   // "stripe_webhook" | "manual_admin" | "import"
  recordedBy    String?  // User.id of the admin who recorded (manual only)
  notes         String   @default("")
  createdAt     DateTime @default(now())
  @@index([invoiceId])
}
```

### 4.4 Invoice column additions

- `dueDate DateTime?` (from order paymentTerms)
- `paidAt DateTime?`
- `paidReference String?`
- `paymentMethod String?`
- `partialPaidCents Int @default(0)`
- `stripeInvoiceId String? @unique` (option B)
- `status` enum extended: `ISSUED | PAID | OVERDUE | UNCOLLECTIBLE | VOIDED`

---

## 5. A/R dashboard

New page `/admin/accounts-receivable`. Server-rendered.

### 5.1 Top-level metrics

- Total outstanding (cents)
- Total overdue (cents)
- Count of unique orgs with outstanding A/R
- Average days-to-pay over last 90 days (paidAt - issuedAt mean)
- Total fronted-to-suppliers (cents): sum of slot payouts disbursed where
  the corresponding Invoice is not yet paid (per section 7, if we eat the
  float). This is PartsPort's working-capital exposure at a glance.

### 5.2 Aging buckets

For each unpaid invoice, bucket by `now() - dueDate`:

- Current (negative or 0 days: not yet due)
- 1-30 days past
- 31-60 days past
- 61-90 days past
- 90+ days past

Render as a stacked horizontal bar at the top.

### 5.3 Per-org rollup table

Columns: Org name | Terms | Credit limit | Outstanding | Overdue |
Available credit | Oldest invoice age | Status (ACTIVE / SUSPENDED) |
Action (drilldown).

Sort options: outstanding desc (default), oldest overdue desc, available
credit asc.

### 5.4 Org drilldown

`/admin/accounts-receivable/[orgId]`. Header card (limit, available,
outstanding, terms, status, payment history sparkline). Tabs:

- Outstanding invoices (table: ref, order, issued, due, age, total,
  partial paid, status, action: record payment / send reminder /
  mark uncollectible / void)
- Paid invoices (last 12 months, with days-to-pay per row)
- Members (BuyerOrgMember list)
- Activity (AuditLog filtered to this org)

### 5.5 Per-supplier exposure tab

Toggleable view on the dashboard. For each supplier with unpaid buyer
invoices that already triggered a payout: sum(slot payout cents) where
the parent Invoice is unpaid. Tells PartsPort how much working capital is
out on each supplier's behalf. Drives the section-7 decision on hold-vs-
pay policy.

### 5.6 CSV export

Two endpoints, both `csvSafeCell`-guarded per PLH-2 4a:

- `/api/admin/ar/outstanding.csv`: every unpaid invoice with org,
  amounts, dates, contact info.
- `/api/admin/ar/payments.csv`: every `PaymentRecord` in a date range,
  for accounting recon.

QuickBooks integration (PLH-3i) handles the bookkeeping export; this CSV
exists for ad-hoc admin work and for the moment QBO is down.

---

## 6. Dunning workflow

State machine driven by a new cron + Email model rows tied to each
invoice.

### 6.1 Cadence

- T-3 days before due: gentle "heads up, due Friday" email.
- T-0 (due date): "due today" email.
- T+3 past due: first reminder, friendly.
- T+7 past due: firm reminder, copy AP contact email if set.
- T+14 past due: escalation reminder, copy admin (rad@agentgaming.gg).
- T+30 past due: final notice + auto-suspend warning (BuyerOrg flips to
  SUSPENDED in 24 hours unless paid).
- T+31 past due (or configurable `AR_SUSPEND_DAYS_PAST_DUE`):
  BuyerOrg.status flips to SUSPENDED, `sendBuyerOrgSuspended` fires to
  all org admins, future orders rejected at checkout.

All thresholds env-configurable per PLH-3j P12 pattern
(`AR_DUNNING_PRE_DAYS`, `AR_DUNNING_THRESHOLDS` JSON, etc).

### 6.2 Cron

`/api/cron/ar-dunning`. Daily at 08:00 UTC (after payouts and reconcile,
before QBO sync). `MAX_PER_RUN=200`, ASC, `hasMore`, mirrors PLH-2 4e.

For each unpaid invoice:

1. Compute days-from-due.
2. Pick the matching threshold (or none).
3. Check `Email` table for an idempotency row keyed on
   `(invoiceId, dunningStage)`. Skip if present. (Add `dunningStage`
   column to Email model: `null` for non-dunning emails,
   `"T-3" | "T0" | "T+3" | ... | "T+30" | "SUSPEND"` for dunning.)
4. Send via `shouldSendToUser(buyer, "order")` gate (PLH-2 4d).
5. Insert Email row with stage. Audit `AR_DUNNING_SENT` with metadata
   `{ invoiceId, stage, daysFromDue }`.
6. At T+30 also flip Invoice.status to OVERDUE (idempotent).

### 6.3 Self-service pay link

Every dunning email embeds a signed-token deep link to a hosted payment
page. With Stripe Invoices (option B), that link is the Stripe-hosted
invoice URL (no signing needed). Without, it is a PartsPort page
`/invoices/[id]?t=<hmac>` (HMAC over invoiceId off `INVOICE_LINK_SECRET`,
falls back to `SESSION_SECRET`, mirrors PLH-3c F0/F4 `orderViewUrl()`).

### 6.4 Suspend / reactivate

On suspend: BuyerOrg.status="SUSPENDED", `suspendedAt`, `suspendedReason
="dunning_30_days"`. `/api/orders` rejects with 423 "Account suspended
for past-due balance, contact AP@your-org" for any user whose
`currentBuyerOrgId.status="SUSPENDED"`.

On payment received (via Stripe webhook or manual): if BuyerOrg was
SUSPENDED and `totalOutstandingCents` after this payment falls below a
configurable `AR_REACTIVATE_THRESHOLD_CENTS` (default 0, i.e. fully
cleared), flip status="ACTIVE", clear `suspendedAt/Reason`,
`sendBuyerOrgReactivated`, audit `BUYER_ORG_REACTIVATED`.

### 6.5 Tone

Drafts ship in a corporate-professional voice (not cute, not threatening).
Conrad to confirm in section 9. Reference body:

- T-3: "Invoice [number] for $X is due [date]. Pay link: [url]."
- T+7: "Invoice [number] is 7 days past due. Please remit at [url] or
  contact AP@partsport.com if there is an issue."
- T+30: "Invoice [number] is 30 days past due. Per our terms, your
  account will be suspended on [date+1] if this balance is not cleared.
  Pay now: [url]."

No em dashes. Period.

---

## 7. Supplier payout impact

The core trade-off in this round.

### 7.1 Default (recommended): PartsPort fronts the float

Supplier paid out per the existing P8 schedule (5% reserve held, slot
payout fires at `markOrderPaid`). Net-terms invoice means the Order goes
PAID when the BUYER pays. With "pay supplier on order paid" today, that
delays supplier payouts by 30+ days, which kills supplier experience.

So: **for net-terms orders, payouts fire when the order ships, not when
the buyer pays.** PartsPort fronts the cash from operating capital.
A/R dashboard section-5.5 exposure tab shows the float at all times.

Implementation: `markOrderShipped` (or `markSlotShipped` per PLH-3g P5)
checks `order.paymentMethod === "invoice"`. If true, fire the slot
payout 3-stage flow there instead of waiting for `markOrderPaid`. Reserve
still held at 5% same as today. When the buyer eventually pays, the
order flips to PAID, payouts are already disbursed, no double-payment
because each slot has at most one Payout row.

Refund handling: if the buyer never pays AND the supplier already
shipped AND PartsPort already paid the supplier, the platform absorbs
the loss net of the supplier's reserve clawback (`owedToPlatformCents`
gets incremented per the PLH-1 commit-5 clawback primitive; future
supplier payouts pay it down). The 5% reserve is the buffer; if the
buyer write-off exceeds reserve, supplier owes PartsPort the delta.
Whether to actually collect from suppliers on bad-debt write-off is a
section-9 policy question.

### 7.2 Alternative: hold supplier payouts until buyer pays

`markOrderPaid` continues to be the only trigger for slot payouts.
Supplier waits 30-60 days for cash from net-terms orders, but PartsPort
carries zero A/R risk on the supplier side.

Pros: zero working-capital strain on PartsPort.
Cons: supplier dashboards show "$50K shipped, $0 paid" for weeks. We
will lose suppliers to faster-paying marketplaces. Supplier-experience
parity with non-net-terms orders is destroyed; the supplier cannot tell
which buyer caused the delay.

### 7.3 Hybrid (deferred)

Supplier flag `acceptsNetTermsOrders` per supplier. Default true with
PartsPort-fronting-float. Suppliers can opt out (those orders then
require the buyer to PREPAID). Backlog item for now; the default path
covers 95% of cases.

### 7.4 Supplier dashboard messaging

Whichever path: the supplier order card surfaces "Buyer is on NET_30
terms. Payout fires on ship date. Invoice due [date]." So the supplier
sees the policy explicitly and is not surprised. If we ever switch to
section-7.2 hold-policy, the same surface shows "Payout fires when buyer
pays invoice (due [date])."

---

## 8. Schema changes (consolidated)

New models: `BuyerOrg`, `BuyerOrgMember`, `CreditApplication`,
`PaymentRecord` (see sections 1, 2, 4).

New enum: `PaymentTerms`.

New columns:

- `User.currentBuyerOrgId String?` + index
- `Order.buyerOrgId String?` + index
- `Order.paymentTerms PaymentTerms?` (snapshotted at order time)
- `Order.invoiceDueDate DateTime?`
- `Invoice.dueDate DateTime?` (mirrors order)
- `Invoice.paidAt DateTime?`
- `Invoice.paidReference String?`
- `Invoice.paymentMethod String?`
- `Invoice.partialPaidCents Int @default(0)`
- `Invoice.stripeInvoiceId String? @unique` (if section-3 option B)
- `Invoice.status` enum extended
- `Email.dunningStage String?` (section 6.2 idempotency)

Migration order (one migration per logical group keeps rollbacks safe):

1. `add_buyer_org` (BuyerOrg + BuyerOrgMember + PaymentTerms enum +
   `User.currentBuyerOrgId`)
2. `add_credit_application` (CreditApplication model only)
3. `add_order_invoice_terms` (Order + Invoice columns, Invoice.status
   enum extension)
4. `add_payment_record` (PaymentRecord + Email.dunningStage)
5. `backfill_buyer_orgs` (data migration: for any existing User with
   `companyName` set, optionally create a BuyerOrg-of-1 in PREPAID mode
   so the model is uniform; skip if Conrad prefers to do this lazily)

All migrations forward-only. CHECK constraints to add:

- `Invoice.partialPaidCents >= 0`
- `Invoice.partialPaidCents <= Invoice.totalCents`
- `BuyerOrg.creditLimitCents >= 0`
- `CreditApplication.requestedLimitCents > 0`

---

## 9. Cross-cutting decisions for Conrad

One line each. Default in **bold** when one exists.

1. Pay suppliers on ship date for net-terms orders (PartsPort fronts the
   float) vs. hold until buyer pays? **Default: fronts the float.**
2. ACH/wire collection rail: Stripe Invoices, PartsPort's own bank, or
   Brex/Bill.com? **Default: Stripe Invoices.**
3. Default terms for a freshly approved org: **NET_30** unless application
   says otherwise?
4. Auto-suspend threshold (days past due): **30 days.**
5. Auto-reactivate threshold on payment: **full balance cleared** (vs.
   partial pay re-opens credit).
6. Dunning tone: **corporate-professional**, not cute, not threatening.
7. Late fee policy: charge interest (e.g. 1.5%/month per net-30 norms),
   fixed late fee, or neither? **Default: neither for round 1, revisit
   after first quarter of A/R data.**
8. Outsource collections at N days past due? **Default: never auto. Manual
   admin escalation at T+60, write off at T+120 with bad-debt audit row
   and supplier clawback if applicable.**
9. Auto-approve credit applications below a threshold? **Default: no auto-
   approve in round 1**, all manual. Revisit after first 50 applications
   to see if patterns justify automation.
10. Multi-user orgs: should regular MEMBERs be able to place invoice
    orders, or only ADMINs? **Default: any member can purchase; ADMIN
    required for credit-limit changes and reactivation.**
11. Tax-exempt cert (PLH-3j P4) vs BuyerOrg: stays on Address, OR
    promote to BuyerOrg? Default: keep on Address for now (per-ship-to
    granularity matters for state nexus), revisit if orgs request
    org-level exemption.

---

## 10. Recommended round breakdown

4 rounds. Each independently shippable; the platform stays usable after
every one.

### Round 1: BuyerOrg + invoice-flow plumbing (no credit gating yet)

- Migrations 1, 3 (BuyerOrg, BuyerOrgMember, PaymentTerms enum,
  Order/Invoice terms columns, Invoice status enum extension).
- `/api/orders` POST branch for `paymentMethod="invoice"` — but only
  admins can flip an org to a non-PREPAID terms value via a stub admin
  page. No buyer-facing application form yet.
- Invoice generation moved to order-create time when invoice flow.
- `sendInvoiceIssued` email with PDF (reuse existing Invoice PDF render).
- Admin can manually create a BuyerOrg + add members + set terms +
  set credit limit at `/admin/buyer-orgs`.
- Ship status: a friendly Conrad/team-pilot path to onboard one
  net-30 buyer manually end-to-end. Validates the flow before we open it
  up.

### Round 2: Stripe Invoices integration + payment recording

- Migration 4 (PaymentRecord, Email.dunningStage).
- `Invoice.stripeInvoiceId` column.
- On invoice generation, also create the Stripe Invoice via the API
  (`collection_method=send_invoice`, `payment_settings.payment_method_
  types=["us_bank_account"]`).
- Webhook handler for `invoice.paid` / `invoice.payment_failed` /
  `invoice.marked_uncollectible`.
- `markOrderPaid` integration so QBO sync (PLH-3i P2) fires
  automatically on net-terms payment.
- Manual mark-paid admin route as fallback (for the rare wire-direct
  payment).
- Ship status: end-to-end automated cash collection.

### Round 3: Credit application + A/R dashboard

- Migration 2 (CreditApplication).
- Buyer-facing `/credit-application` form.
- Admin `/admin/credit-applications` review page.
- `/admin/accounts-receivable` dashboard (sections 5.1-5.5).
- `/admin/accounts-receivable/[orgId]` org drilldown.
- CSV exports (section 5.6).
- Audit log entries for all credit-state transitions.
- Ship status: self-serve onboarding for new enterprise buyers.

### Round 4: Dunning + suspend + payout policy

- `/api/cron/ar-dunning` cron + dunning email templates (section 6).
- Auto-suspend / reactivate flow.
- Self-service pay link in emails.
- `markOrderShipped` payout-trigger branch for net-terms orders
  (section 7.1).
- Supplier dashboard messaging for net-terms order cards.
- Section-5.5 supplier exposure tab.
- Ship status: A/R machine is autonomous; admin only intervenes on
  T+60 escalation.

### Optional round 5 (defer to post-launch unless Conrad asks)

- D-U-N-S lookup integration for credit-limit suggestions.
- Auto-approve threshold (decision 9 above).
- Late fees (decision 7).
- Hybrid supplier opt-out flag (section 7.3).
- Multi-currency / international.
- API for buyer's AP system to fetch open invoices.

---

## Out of scope for this spec

- International / non-USD net terms.
- Factoring / invoice-discounting integration (selling A/R for cash).
- Buyer-side PO numbers as a hard requirement (we collect a `poNumber`
  optional field on the order, but do not enforce PO-matching).
- Tax-exempt org-level certs (currently per-Address; revisit per
  decision 11).
- Sub-net terms (e.g. 2/10 net 30 early-pay discounts). Skip until at
  least one enterprise buyer asks.

End of spec.
