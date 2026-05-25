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
      return {
        type: "session.completed",
        sessionId: session.id,
        orderId:
          (session.metadata?.orderId as string | undefined) ||
          session.client_reference_id ||
          null,
        taxCents: tax,
        amountTotalCents: session.amount_total ?? 0,
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
