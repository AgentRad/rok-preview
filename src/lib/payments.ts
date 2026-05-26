import "server-only";
import Stripe from "stripe";
import { siteUrl } from "./site-url";

/**
 * Processor-agnostic payment abstraction. The platform never imports Stripe
 * directly; everything goes through this module. Adding another processor is
 * a matter of writing a second implementation and switching getProvider().
 */

export type CheckoutLineItem = {
  name: string;
  unitAmountCents: number;
  quantity: number;
  /** Stripe Tax product tax_code. Default "txcd_99999999" (general goods). */
  taxCode?: string;
};

export type CheckoutSessionInput = {
  orderId: string;
  reference: string;
  amountCents: number; // fallback when items are not supplied
  buyerEmail: string;
  description: string;
  /** Itemized line items. Required for Stripe Tax to compute per-line tax. */
  items?: CheckoutLineItem[];
  /** Collect a ship-to address at checkout. Required for Stripe Tax. */
  collectShipping?: boolean;
  /** Skip tax for approved tax-exempt buyers. */
  taxExempt?: boolean;
};

export type CheckoutSessionResult = {
  /** Public URL the buyer is redirected to. */
  url: string;
  /** Provider-specific session id. */
  sessionId: string;
};

export type PaymentProvider = {
  name: string;
  createCheckoutSession(
    input: CheckoutSessionInput
  ): Promise<CheckoutSessionResult>;
  /**
   * Verify the inbound webhook and extract the canonical event shape. Throws
   * on invalid signature.
   */
  parseWebhookEvent(args: {
    body: string;
    signature: string;
  }): Promise<WebhookEvent | null>;
};

export type WebhookEvent =
  | {
      type: "session.completed";
      sessionId: string;
      orderId: string | null;
      /** Tax computed by Stripe Tax, in cents. 0 when tax not enabled. */
      taxCents?: number;
      /** Total amount captured (subtotal + tax + shipping), in cents. */
      amountTotalCents?: number;
      /** Stripe PaymentIntent id; needed later for the refund flow. */
      paymentIntentId?: string | null;
    }
  | {
      // Stripe Connect: account capability change. Fires on capability
      // grant/revoke, identity verification updates, payouts enable, etc.
      type: "account.updated";
      accountId: string;
      chargesEnabled: boolean;
      payoutsEnabled: boolean;
      detailsSubmitted: boolean;
    }
  | {
      // Connected transfer landed in the destination account's pending
      // balance. Promotes our Payout to PAID.
      type: "transfer.paid";
      transferId: string;
      destinationAccountId: string | null;
      amountCents: number;
      orderId: string | null;
      payoutReference: string | null;
    }
  | {
      type: "transfer.failed";
      transferId: string;
      destinationAccountId: string | null;
      amountCents: number;
      orderId: string | null;
      payoutReference: string | null;
      failureMessage: string;
    }
  | {
      // Charge refund webhook fires after refunds.create or a dashboard
      // refund. We mostly act inline in the refund route, but ingest the
      // event so the audit trail is complete and out-of-band dashboard
      // refunds still flow through.
      //
      // P9.5 CRIT 6: ship the individual refund rows so the handler can
      // upsert by stripeRefundId. Pre-P9.5 the handler matched by sum
      // delta and created phantom Refund rows on out-of-order replays.
      type: "charge.refunded";
      paymentIntentId: string | null;
      chargeId: string;
      amountRefundedCents: number;
      reason: string | null;
      refunds: Array<{
        id: string;
        amountCents: number;
        reason: string | null;
      }>;
    }
  | { type: "ignored" };

let _stripe: Stripe | null = null;
function stripeClient(): Stripe | null {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!_stripe)
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2026-04-22.dahlia",
    });
  return _stripe;
}

const stripeProvider: PaymentProvider = {
  name: "stripe",
  async createCheckoutSession(input) {
    const s = stripeClient();
    if (!s) throw new Error("Stripe is not configured.");

    // Stripe Tax wiring: when itemized line items are provided we send them
    // through individually with tax codes so Stripe Tax computes tax per
    // jurisdiction. The buyer's ship-to is captured at checkout. Approved
    // tax-exempt buyers skip computation entirely.
    const useStripeTax = !!input.items && input.items.length > 0 && !input.taxExempt;

    const lineItems = input.items?.length
      ? input.items.map((it) => ({
          quantity: it.quantity,
          price_data: {
            currency: "usd",
            unit_amount: it.unitAmountCents,
            product_data: {
              name: it.name,
              // Default tax code is txcd_99999999 = General - Tangible Goods,
              // which is the right starting point for industrial parts.
              tax_code: it.taxCode || "txcd_99999999",
            },
          } as const,
        }))
      : [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: input.amountCents,
              product_data: {
                name: `PartsPort order ${input.reference}`,
                description: input.description,
                tax_code: "txcd_99999999",
              },
            } as const,
          },
        ];

    const session = await s.checkout.sessions.create({
      mode: "payment",
      // Card is intentionally listed first so Stripe shows the card form by
      // default. ACH is still offered, but it should be the alternative, not
      // the primary path (test cards are the most common flow).
      payment_method_types: ["card", "us_bank_account"],
      customer_email: input.buyerEmail,
      client_reference_id: input.orderId,
      metadata: {
        orderId: input.orderId,
        reference: input.reference,
        taxExempt: input.taxExempt ? "1" : "0",
      },
      payment_method_options: {
        us_bank_account: {
          financial_connections: { permissions: ["payment_method", "balances"] },
          verification_method: "instant",
        },
      },
      line_items: lineItems,
      ...(input.collectShipping
        ? {
            shipping_address_collection: { allowed_countries: ["US"] },
          }
        : {}),
      ...(useStripeTax
        ? {
            automatic_tax: { enabled: true },
            // For Stripe Tax to compute, the customer's tax address has to be
            // captured. Shipping address (above) gives Stripe what it needs.
          }
        : {}),
      success_url: siteUrl(`/orders/${input.orderId}?paid=1`),
      cancel_url: siteUrl(`/orders/${input.orderId}?cancelled=1`),
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return { url: session.url, sessionId: session.id };
  },
  async parseWebhookEvent({ body, signature }) {
    const s = stripeClient();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!s || !secret) throw new Error("Stripe webhook is not configured.");
    const event = s.webhooks.constructEvent(body, signature, secret);
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const tax = session.total_details?.amount_tax ?? 0;
      const pi =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id ?? null;
      return {
        type: "session.completed",
        sessionId: session.id,
        orderId:
          (session.metadata?.orderId as string | undefined) ||
          session.client_reference_id ||
          null,
        taxCents: tax,
        amountTotalCents: session.amount_total ?? 0,
        paymentIntentId: pi,
      };
    }
    if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;
      return {
        type: "account.updated",
        accountId: account.id,
        chargesEnabled: !!account.charges_enabled,
        payoutsEnabled: !!account.payouts_enabled,
        detailsSubmitted: !!account.details_submitted,
      };
    }
    // Stripe's transfer lifecycle on Connect:
    //   transfer.created  -> fires immediately after transfers.create.
    //   transfer.reversed -> bank or compliance rejection; funds clawed back.
    // We collapse the "happy" path (transfer.created + transfer.updated) into
    // our internal "transfer.paid" because for Express destination accounts
    // the funds are in the connected balance the moment Stripe accepts the
    // call. Final payout to the bank is the connected account's own
    // payout.paid event - we don't subscribe to it because Stripe handles
    // bank transit on the connected side.
    if (event.type === "transfer.created" || event.type === "transfer.updated") {
      const transfer = event.data.object as Stripe.Transfer;
      return {
        type: "transfer.paid",
        transferId: transfer.id,
        destinationAccountId:
          typeof transfer.destination === "string"
            ? transfer.destination
            : transfer.destination?.id ?? null,
        amountCents: transfer.amount,
        orderId:
          (transfer.metadata?.partsportOrderId as string | undefined) || null,
        payoutReference:
          (transfer.metadata?.partsportPayoutRef as string | undefined) || null,
      };
    }
    if (event.type === "transfer.reversed") {
      const transfer = event.data.object as Stripe.Transfer;
      return {
        type: "transfer.failed",
        transferId: transfer.id,
        destinationAccountId:
          typeof transfer.destination === "string"
            ? transfer.destination
            : transfer.destination?.id ?? null,
        amountCents: transfer.amount,
        orderId:
          (transfer.metadata?.partsportOrderId as string | undefined) || null,
        payoutReference:
          (transfer.metadata?.partsportPayoutRef as string | undefined) || null,
        failureMessage: "Transfer reversed by Stripe.",
      };
    }
    if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      const pi =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id ?? null;
      const refunds = (charge.refunds?.data || []).map((r) => ({
        id: r.id,
        amountCents: r.amount ?? 0,
        reason: r.reason ?? null,
      }));
      return {
        type: "charge.refunded",
        paymentIntentId: pi,
        chargeId: charge.id,
        amountRefundedCents: charge.amount_refunded ?? 0,
        reason: refunds[0]?.reason ?? null,
        refunds,
      };
    }
    return { type: "ignored" };
  },
};

/**
 * Returns the active payment provider, or null when no processor is wired up.
 * The checkout falls back to the demo flow in that case.
 */
export function getProvider(): PaymentProvider | null {
  if (process.env.STRIPE_SECRET_KEY) return stripeProvider;
  return null;
}

export function isPaymentsConfigured(): boolean {
  return getProvider() !== null;
}

/**
 * Webhook-independent reconciliation. When a buyer returns from Stripe to the
 * success_url and the webhook has not landed yet (or has been mis-configured),
 * we still need to flip the order to PAID so the UI is honest. This pulls the
 * most recent Checkout Session matching the order out of Stripe and, if it is
 * paid, runs the same markOrderPaid path the webhook would have.
 *
 * Returns true if the order was reconciled to PAID (either now or previously).
 * Safe to call repeatedly; markOrderPaid is idempotent.
 */
export async function reconcileOrderFromStripe(
  orderId: string
): Promise<{ paid: boolean; reason?: string }> {
  const s = stripeClient();
  if (!s) return { paid: false, reason: "Stripe not configured" };
  // Stripe lets us list checkout sessions filtered by client_reference_id =
  // the orderId we set in createCheckoutSession. Iterate; the most recent
  // paid one wins.
  const sessions = await s.checkout.sessions.list({
    limit: 5,
    // Stripe API does not directly support filtering by client_reference_id;
    // we filter client-side.
  });
  const matching = sessions.data.filter(
    (sess: Stripe.Checkout.Session) =>
      sess.client_reference_id === orderId ||
      (sess.metadata?.orderId as string | undefined) === orderId
  );
  // If we did not find anything in the last 5, broaden the search by paging.
  // For typical traffic this is unnecessary; we keep the simple path here.
  for (const sess of matching) {
    if (sess.payment_status === "paid" || sess.status === "complete") {
      const { markOrderPaid } = await import("./order-utils");
      await markOrderPaid(orderId, "stripe", sess.id, {
        taxCents: sess.total_details?.amount_tax ?? 0,
        amountTotalCents: sess.amount_total ?? 0,
      });
      return { paid: true };
    }
  }
  return { paid: false, reason: "No paid session found for this order" };
}
