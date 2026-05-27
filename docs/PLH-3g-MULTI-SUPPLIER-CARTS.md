# PLH-3g — Multi-supplier carts + per-supplier payment/payout/refund

Paste this into a fresh build chat after PLH-3e is verified on prod
and you're ready to take on a multi-day refactor.

```
# CONTEXT
You're working on PartsPort at C:\Users\radfe\rok-preview, branch
claude/industrial-marketplace-ROwAU, HEAD b163953 (or wherever PLH-3e
ended). Read CLAUDE.md, HABITS.md, docs/ORCHESTRATOR.md.

Conrad asked 2026-05-26 for multi-supplier carts to ship now, not
post-launch. This was the deferred Launch-time constraint in CLAUDE.md
("A buyer's cart can only contain items from one supplier"). The full
refactor was scoped at PLH-1 commit 5 time as "one Order, N Shipments,
per-supplier payment intent splits via Stripe Connect destination
charges, per-supplier refund flows" and explicitly deferred.

The refactor is real and multi-day. Sequence the commits so each
phase ships independently and the platform stays bootable between
commits.

# THE SHAPE OF THE FIX

Today: one Order = one supplier. Cart enforces this client-side
(src/lib/cart.ts) and server-side (/api/orders POST). Payment is a
single Stripe Checkout Session with a destination charge to one
Connect account. Payouts, refunds, clawback all assume one supplier
per Order.

After this round: one Order can carry items from multiple suppliers.
Each Order spawns N Shipments (one per supplier). The Stripe charge
flows to the platform; the platform issues separate Transfers to each
supplier's Connect account on dispatch. Refunds are per-supplier
(refund order item X, clawback only from supplier owning X). Buyer
sees per-supplier sections in cart, checkout, order detail, emails.
Supplier sees only their own items in their dashboard.

# PHASE PLAN (one commit per phase, ship in this order)

## Phase 1: Schema audit + Shipment model harden

The Shipment model exists from Polish 9 (per CLAUDE.md). Read
prisma/schema.prisma and confirm:
- Order has many OrderItem
- OrderItem has supplierId via Product
- Shipment has Order + supplierId + carrier + trackingCode + status
- Payout has Order + supplierId + amountCents

If anything is missing for per-supplier-on-one-order to work, add it
in this phase. Specifically:
- Order needs a per-supplier subtotal/freight/fee breakdown computed
  at order creation time so payouts can be derived deterministically
- Probably an OrderSupplierSlot model: { orderId, supplierId,
  subtotalCents, freightCents, feeCents, refundedCents, payoutId }
  with unique index on (orderId, supplierId)

Migration: prisma/migrations/<timestamp>_add_order_supplier_slot
(or whatever names you pick). Backfill: for every existing Order,
derive one OrderSupplierSlot from the supplier of its items (since
they're all the same supplier today).

Commit: "PLH-3g P1: OrderSupplierSlot model + backfill migration"

## Phase 2: Remove single-supplier-cart enforcement

src/lib/cart.ts client-side check: replace the "your cart contains
items from <supplier>" blocker with a non-blocking notice that the
cart spans suppliers. /api/orders POST: drop the server-side reject.

Update the cart UI to render items grouped by supplier with a
per-supplier subtotal + freight + fee breakdown.

Commit: "PLH-3g P2: allow multi-supplier carts, group cart UI"

## Phase 3: Order creation builds OrderSupplierSlot rows

In /api/orders POST: when creating an Order, also create one
OrderSupplierSlot per supplier in the cart with that supplier's
subtotal/freight/fee derived from their items + their warehouse's
freight quote (existing multi-supplier freight split from Polish 9).

Wrap in $transaction. Server-trust subtotal/freight/fee against the
client claim like P12 C1 does.

Commit: "PLH-3g P3: order creation generates per-supplier slots"

## Phase 4: Stripe Checkout uses one session with multiple Connect
transfers via Separate Charges and Transfers

Stripe pattern:
- Buyer pays platform via standard Stripe Checkout Session
- Platform holds funds
- On dispatch (per-supplier), platform calls stripe.transfers.create
  with destination = supplier's Connect account id, amount = that
  supplier's subtotal slot
- Existing payouts.ts already does this 3-stage pattern for a single
  supplier (PLH-1 C3 + P12 C2); refactor to iterate
  OrderSupplierSlot rows

Read src/lib/payouts.ts and src/lib/payments.ts. Refactor
markOrderPaid / dispatchOrder helpers to iterate slots instead of
assuming one supplier.

Commit: "PLH-3g P4: payment + per-supplier transfers via slots"

## Phase 5: Per-supplier dispatch + Shipment flow

When supplier marks shipped, ONLY their Shipment flips to Shipped.
The Order's overall shipmentStage becomes a derived value: "Shipped"
when ALL Shipments are Shipped, otherwise the highest-floor state
across suppliers ("Partial: 1 of 3 shipped"). Buyer sees this
nuance in /orders/[id].

src/lib/shipping.ts markOrderShipped → update to accept a Shipment
id (not Order id) and only flip that one row. Compute the Order's
aggregate shipmentStage from the Shipments.

Commit: "PLH-3g P5: per-supplier shipment dispatch + aggregate state"

## Phase 6: Per-supplier refund + clawback

Today src/lib/refunds.ts + applySupplierClawback iterate the Order's
suppliers. Refactor to accept a per-item or per-slot refund: refund
a specific OrderItem or all items belonging to a specific supplier.
Clawback decrements ONLY that supplier's owedToPlatformCents +
reserveBalanceCents.

The charge.refunded Stripe webhook (PLH-1 C5) currently calls
applySupplierClawback for the order's one supplier; refactor to
identify which slot the refund applies to via stripe refund metadata.

Commit: "PLH-3g P6: per-supplier refund routing + clawback"

## Phase 7: Buyer UX

/orders/[id] page: render Shipments grouped by supplier, each with
its own tracking, ship-to (same for all suppliers, since one buyer),
status, and per-supplier line items.

Invoice page /orders/[id]/invoice: still one invoice per order with
a per-supplier section breakdown.

Order emails (confirmation, shipped, delivered): one email per
state-change, but the body shows per-supplier details where relevant.

Commit: "PLH-3g P7: buyer UI shows per-supplier shipments + invoice"

## Phase 8: Supplier UX scoping

/supplier dashboard: when viewing an order, supplier sees only THEIR
items + THEIR shipment + THEIR payout slice. Cross-supplier line
items are not exposed.

/admin sees the full Order with all suppliers (admin role is
unchanged).

Commit: "PLH-3g P8: supplier dashboard scoped to own slot"

## Phase 9: End-to-end test fixture

Add a seed in prisma/seed.mjs that creates a 2-supplier order to
exercise the new code paths. Add a Vitest unit test for the
per-supplier slot math (split a synthetic cart, assert each slot's
subtotal/freight/fee adds up to the Order total).

Manual smoke: log in as a buyer, add two items from two different
suppliers, check out via test-mode Stripe, both suppliers see their
slice, mark each shipped, confirm aggregate state transitions
correctly, refund one supplier's item, confirm clawback only
touches that supplier.

Commit: "PLH-3g P9: multi-supplier e2e fixtures + tests"

# CROSS-CUTTING REQUIREMENTS

- Every $ math operation goes through $transaction with re-read +
  Math.min on success (same pattern as P12 C2 and PLH-2 4e E3).
- Every state mutation writes an AuditLog row.
- npx next build must pass at EVERY commit (no half-broken interim
  states).
- No em dashes in user-facing copy.
- Soft brand model still enforced (Phase 3 item creation still
  validates manufacturer via isClaimedManufacturer).

# CONSTRAINTS TO PRESERVE

- Single-supplier-Order data still works (the 2026-05-26 cutover
  shouldn't break historical orders; the backfill in Phase 1 handles
  this).
- Suspended suppliers still blocked from new orders (PLH-1 C3 +
  PLH-3e B2).
- Soft brand model still enforced (PLH-3c F1).
- Email-verify gate on /api/orders POST + /api/checkout-from-quote
  (PLH-3e F2).
- Existing tests must still pass (run vitest + playwright at the end
  of each phase if available).

# REPORTING

After each phase commit, push to origin. Report to orchestrator
after every commit: HEAD hash, files changed, anything surprising.

After all 9 phases land:
- Update CLAUDE.md Launch-time constraints section: remove the
  single-supplier-cart constraint.
- Update CLAUDE.md Status section: add a PLH-3g block describing the
  refactor.
- Update docs/ORCHESTRATOR.md: extend the audit-rounds section.
- Bump the cumulative scorecard.
```
