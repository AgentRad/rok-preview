import "server-only";

export type TaxCalculation = {
  taxCents: number;
  isExempt: boolean;
};

export function isStripeTaxConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
}

/**
 * Calculate tax for an order. If Stripe Tax is configured and the buyer
 * doesn't have an approved tax-exempt certificate, use Stripe Tax.
 * Otherwise, return $0 tax (tax calculation deferred to Stripe checkout).
 */
export async function calculateTax(args: {
  subtotalCents: number;
  freightCents: number;
  feeCents: number;
  shipTo: string; // Ship-to address
  taxExemptStatus?: string | null; // 'APPROVED', 'PENDING', 'REJECTED', or null
}): Promise<TaxCalculation> {
  // If buyer has an approved tax-exempt certificate, no tax
  if (args.taxExemptStatus === "APPROVED") {
    return { taxCents: 0, isExempt: true };
  }

  // If Stripe Tax is not configured, defer to checkout (return 0 for now)
  if (!isStripeTaxConfigured()) {
    return { taxCents: 0, isExempt: false };
  }

  // TODO: Integrate Stripe Tax API here
  // This would call Stripe's tax service to calculate the actual tax amount
  // based on the shipping address and line items.
  // For now, return 0 and let Stripe handle it in the Checkout Session.

  return { taxCents: 0, isExempt: false };
}
