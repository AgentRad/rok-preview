export function formatCents(cents: number): string {
  return (
    "$" +
    (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  );
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export const FEE_RATE_BPS = 400; // 4%

export function feeFor(subtotalCents: number, bps = FEE_RATE_BPS): number {
  return Math.round((subtotalCents * bps) / 10000);
}
