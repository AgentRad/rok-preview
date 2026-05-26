import "server-only";
import Stripe from "stripe";
import type { Supplier } from "@prisma/client";
import { prisma } from "./db";
import { siteUrl } from "./site-url";
import { captureError } from "./observability";

/**
 * Thin wrapper over Stripe Connect Express. Lazy-init the client so the
 * platform still runs (Connect features just degrade to "not configured")
 * when STRIPE_SECRET_KEY is absent in a preview deploy.
 *
 * Connect onboarding is browser-driven: we create an Express account if
 * none exists, then mint an account link URL the supplier is redirected
 * to. The Stripe-hosted flow handles identity + bank capture; the only
 * thing PartsPort sees is the final status delta delivered via the
 * account.updated webhook.
 */

let _client: Stripe | null = null;
function client(): Stripe | null {
  if (_client) return _client;
  if (!process.env.STRIPE_SECRET_KEY) return null;
  _client = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-04-22.dahlia",
  });
  return _client;
}

export function isStripeConnectConfigured(): boolean {
  return client() !== null;
}

/**
 * Ensure the supplier has a Stripe Connect Express account. Creates one
 * on first call and persists the id; subsequent calls reuse it. Returns
 * null when Stripe isn't configured.
 */
export async function ensureSupplierAccount(
  supplier: Supplier
): Promise<string | null> {
  const s = client();
  if (!s) return null;
  if (supplier.stripeAccountId) return supplier.stripeAccountId;

  const account = await s.accounts.create({
    type: "express",
    country: "US",
    email: supplier.contactEmail || undefined,
    business_profile: {
      name: supplier.name,
      url: supplier.website || undefined,
      // Industrial distribution / wholesale; Stripe asks for an MCC for
      // 1099-K classification. 5085 (industrial supplies) is the closest
      // standard code.
      mcc: "5085",
    },
    capabilities: {
      transfers: { requested: true },
    },
    settings: {
      payouts: { schedule: { interval: "daily" } },
    },
    metadata: {
      partsportSupplierId: supplier.id,
      partsportSupplierName: supplier.name,
    },
  });

  await prisma.supplier.update({
    where: { id: supplier.id },
    data: { stripeAccountId: account.id },
  });
  return account.id;
}

/**
 * Generate a fresh Stripe-hosted onboarding URL. The supplier dashboard
 * never embeds the form; we just redirect there. Account links expire
 * quickly (5 min) so each click mints a new one.
 */
export async function createOnboardingLink(
  supplier: Supplier
): Promise<string | null> {
  const s = client();
  if (!s) return null;
  const accountId =
    supplier.stripeAccountId || (await ensureSupplierAccount(supplier));
  if (!accountId) return null;
  const link = await s.accountLinks.create({
    account: accountId,
    refresh_url: siteUrl("/supplier?stripeOnboard=refresh"),
    return_url: siteUrl("/supplier?stripeOnboard=done"),
    type: "account_onboarding",
  });
  return link.url;
}

/**
 * Pull the latest Connect status from Stripe and snapshot the relevant
 * flags onto our Supplier row. Called from the webhook handler on
 * account.updated and from the admin/manual refresh path.
 *
 * Returns the updated supplier or null if Stripe isn't configured / the
 * supplier has no Connect account yet.
 */
export async function syncSupplierConnectStatus(supplierId: string) {
  const s = client();
  if (!s) return null;
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
  });
  if (!supplier || !supplier.stripeAccountId) return null;
  try {
    const account = await s.accounts.retrieve(supplier.stripeAccountId);
    const completed = !!account.details_submitted &&
      account.payouts_enabled === true;
    return await prisma.supplier.update({
      where: { id: supplierId },
      data: {
        stripeChargesEnabled: !!account.charges_enabled,
        stripePayoutsEnabled: !!account.payouts_enabled,
        stripeOnboardingCompletedAt:
          completed && !supplier.stripeOnboardingCompletedAt
            ? new Date()
            : supplier.stripeOnboardingCompletedAt,
      },
    });
  } catch (err) {
    captureError(err, { subsystem: "stripe-connect", op: "sync", supplierId });
    return null;
  }
}

export type ConnectSnapshot = {
  configured: boolean;
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  onboardingCompletedAt: Date | null;
  /** True when the supplier can receive transfers right now. */
  active: boolean;
  /** Stripe is configured and we have an account id, but capabilities aren't there yet. */
  pending: boolean;
};

export function snapshotConnect(supplier: Supplier): ConnectSnapshot {
  const configured = isStripeConnectConfigured();
  const accountId = supplier.stripeAccountId || null;
  const active = !!accountId && supplier.stripePayoutsEnabled;
  const pending = !!accountId && !active;
  return {
    configured,
    accountId,
    chargesEnabled: supplier.stripeChargesEnabled,
    payoutsEnabled: supplier.stripePayoutsEnabled,
    onboardingCompletedAt: supplier.stripeOnboardingCompletedAt,
    active,
    pending,
  };
}

/**
 * Create a Stripe Transfer to a connected supplier account. Returns the
 * transfer id on success; throws on failure (the caller will catch and
 * mark the Payout FAILED).
 *
 * `amountCents` is what the supplier actually receives - already net of
 * reserve in our callsites.
 */
export async function createTransferToSupplier(args: {
  supplier: Supplier;
  amountCents: number;
  orderId: string;
  payoutReference: string;
}): Promise<string | null> {
  const s = client();
  if (!s) return null;
  if (!args.supplier.stripeAccountId) return null;
  // P9.5 HIGH 9: Stripe idempotency key. Two parallel
  // ensurePayoutsForOrder calls would otherwise race on transfers.create
  // before the Payout row commits, producing duplicate transfers. Stripe
  // returns the original response for repeated requests with the same
  // key, dedupe at their layer. Key shape: payout_<supplierId>_<orderId>
  // (one transfer per supplier-per-order is the invariant).
  const transfer = await s.transfers.create(
    {
    amount: args.amountCents,
    currency: "usd",
    destination: args.supplier.stripeAccountId,
    transfer_group: `order_${args.orderId}`,
    description: `PartsPort payout ${args.payoutReference}`,
    metadata: {
      partsportOrderId: args.orderId,
      partsportPayoutRef: args.payoutReference,
      partsportSupplierId: args.supplier.id,
    },
    },
    {
      idempotencyKey: `payout_${args.supplier.id}_${args.orderId}`,
    }
  );
  return transfer.id;
}

/** Convenience predicate used by the dashboard checklist (P6 + P8). */
export function hasActiveStripeConnect(supplier: Supplier): boolean {
  return (
    !!supplier.stripeAccountId && supplier.stripePayoutsEnabled
  );
}
