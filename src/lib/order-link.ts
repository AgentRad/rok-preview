import crypto from "node:crypto";

/**
 * PLH-3c F0: signed guest-access token for /orders/[id] and
 * /orders/[id]/invoice. Buyer email is bound into the signature so a
 * token issued for one guest order cannot be replayed against another.
 *
 * The token is HMAC-SHA256 of `${orderId}.${emailLower}` truncated to
 * the first 16 bytes (128 bits) and hex-encoded. Verified in constant
 * time via crypto.timingSafeEqual.
 */

function orderLinkSecret(): string {
  return (
    process.env.ORDER_LINK_SECRET ||
    process.env.SESSION_SECRET ||
    "partsport-order-link-fallback"
  );
}

export function signOrderViewToken(orderId: string, email: string): string {
  const payload = `${orderId}.${email.trim().toLowerCase()}`;
  const mac = crypto
    .createHmac("sha256", orderLinkSecret())
    .update(payload)
    .digest();
  return mac.subarray(0, 16).toString("hex");
}

export function verifyOrderViewToken(
  orderId: string,
  email: string | null | undefined,
  token: string | null | undefined
): boolean {
  if (!token || !email) return false;
  if (typeof token !== "string" || token.length !== 32) return false;
  const expected = signOrderViewToken(orderId, email);
  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(expected, "hex");
    b = Buffer.from(token, "hex");
  } catch {
    return false;
  }
  if (a.length !== b.length || a.length !== 16) return false;
  return crypto.timingSafeEqual(a, b);
}
