import "server-only";
import Stripe from "stripe";
import { siteUrl } from "./site-url";

/**
 * Processor-agnostic payment abstraction. The platform never imports Stripe
 * directly; everything goes through this module. Adding another processor is
 * a matter of writing a second implementation and switching getProvider().
 */

export type CheckoutSessionInput = {
  orderId: string;
  reference: string;
  amountCents: number;
  buyerEmail: string;
  description: string;
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
  | { type: "session.completed"; sessionId: string; orderId: string | null }
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
    const session = await s.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["us_bank_account", "card"],
      customer_email: input.buyerEmail,
      client_reference_id: input.orderId,
      metadata: { orderId: input.orderId, reference: input.reference },
      payment_method_options: {
        us_bank_account: {
          financial_connections: { permissions: ["payment_method", "balances"] },
          verification_method: "instant",
        },
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: input.amountCents,
            product_data: {
              name: `PartsPort order ${input.reference}`,
              description: input.description,
            },
          },
        },
      ],
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
      return {
        type: "session.completed",
        sessionId: session.id,
        orderId:
          (session.metadata?.orderId as string | undefined) ||
          session.client_reference_id ||
          null,
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
