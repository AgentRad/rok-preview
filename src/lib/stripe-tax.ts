import "server-only";
import { prisma } from "./db";

/**
 * Stripe Tax helpers.
 *
 * NOTE: There is no `calculateTax(...)` stub here anymore. PartsPort does
 * not pre-compute tax server-side. The real flow:
 *
 *   1. When a buyer hits Pay on a PENDING order, the create-session route
 *      (src/app/api/payments/create-session/route.ts) calls
 *      `provider.createCheckoutSession()` in src/lib/payments.ts with
 *      itemized line items and `collectShipping: true`.
 *
 *   2. The Stripe driver in payments.ts sets `automatic_tax: { enabled: true }`
 *      on the Checkout Session whenever items are itemized and the buyer is
 *      not tax-exempt. Stripe Tax then computes per-jurisdiction tax based
 *      on the shipping address the buyer enters at checkout. Product items
 *      use tax_code `txcd_99999999` (general goods); the marketplace fee
 *      line uses `txcd_10000000` (SaaS).
 *
 *   3. After payment, the webhook (src/app/api/payments/webhook/route.ts)
 *      calls `parseWebhookEvent`, which extracts
 *      `session.total_details.amount_tax` and `session.amount_total`.
 *
 *   4. `markOrderPaid` in src/lib/order-utils.ts takes the tax snapshot and
 *      writes it onto `Order.taxCents` plus re-derives `Order.totalCents`,
 *      so the snapshot matches what the buyer paid. The Invoice picks the
 *      corrected tax up automatically via `ensureInvoiceForOrder`.
 *
 * Tax-exempt buyers: if any of the buyer's saved addresses has
 * `taxExemptStatus = "APPROVED"`, `create-session` passes `taxExempt: true`,
 * which skips `automatic_tax`. Stripe charges zero tax. Tightening this to
 * per-shipping-address exemption requires adding `Order.shippingAddressId`
 * (no model change today; flagged in the Step 4 commit).
 *
 * This file just exposes a couple of helpers: a config probe, and a buyer
 * exemption lookup for code paths outside the checkout flow.
 */

export function isStripeTaxConfigured(): boolean {
  // Stripe Tax piggybacks on the Stripe SDK; if Stripe is configured at all
  // and we are itemizing line items, automatic_tax: enabled will compute
  // tax. The publishable key is required for the client-side redirect, but
  // server-side tax computation only needs the secret key.
  return !!process.env.STRIPE_SECRET_KEY;
}

export type TaxExemptionState = {
  /** Buyer-wide flag: at least one address has APPROVED status. */
  isExempt: boolean;
  /** Latest approved cert URL, if any (for receipts). */
  certificateUrl: string | null;
};

export async function lookupTaxExemption(
  buyerId: string | null | undefined
): Promise<TaxExemptionState> {
  if (!buyerId) return { isExempt: false, certificateUrl: null };
  const approved = await prisma.address.findFirst({
    where: {
      userId: buyerId,
      taxExemptStatus: "APPROVED",
      deletedAt: null,
      // PLH-3j P4: skip certs that have expired so we don't waive tax
      // on a stale cert. Null expiry is treated as "no date on file",
      // which is allowed for pre-P4 certs.
      OR: [
        { taxExemptExpiresAt: null },
        { taxExemptExpiresAt: { gt: new Date() } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  return {
    isExempt: !!approved,
    certificateUrl: approved?.taxExemptCertificateUrl ?? null,
  };
}
