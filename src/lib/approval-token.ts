import "server-only";
import crypto from "node:crypto";

/**
 * PLH-3y-6 C4: signed one-click approval tokens.
 *
 * Token = HMAC-SHA256(secret, `${orderId}.${memberId}.${action}`)
 * truncated to 16 bytes (32 hex chars). Same pattern as order-link.ts.
 * action = "approve" | "reject"
 *
 * The token is embedded in the approver email and consumed by
 * POST /api/approval/decide?order=<id>&member=<id>&action=<action>&t=<token>
 */

function approvalSecret(): string {
  return (
    process.env.ORDER_LINK_SECRET ||
    process.env.SESSION_SECRET ||
    "partsport-approval-token-fallback"
  );
}

export function signApprovalToken(
  orderId: string,
  memberId: string,
  action: "approve" | "reject"
): string {
  const payload = `${orderId}.${memberId}.${action}`;
  const mac = crypto
    .createHmac("sha256", approvalSecret())
    .update(payload)
    .digest();
  return mac.subarray(0, 16).toString("hex");
}

export function verifyApprovalToken(
  orderId: string,
  memberId: string,
  action: string,
  token: string | null | undefined
): boolean {
  if (!token || typeof token !== "string" || token.length !== 32) return false;
  if (action !== "approve" && action !== "reject") return false;
  const expected = signApprovalToken(orderId, memberId, action as "approve" | "reject");
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

/** Build the one-click approve/reject URLs for embedding in emails. */
export function approvalActionUrl(
  orderId: string,
  memberId: string,
  action: "approve" | "reject"
): string {
  const { siteUrl } = require("./site-url") as typeof import("./site-url");
  const token = signApprovalToken(orderId, memberId, action);
  return siteUrl(
    `/api/approval/decide?order=${encodeURIComponent(orderId)}&member=${encodeURIComponent(memberId)}&action=${action}&t=${token}`
  );
}
