import "server-only";
import crypto from "node:crypto";
import { stripQuotedReply } from "./strip-quoted-reply";

export { stripQuotedReply };

/**
 * Inbound email plumbing for reply-by-email.
 *
 * Each outbound message email includes a per-thread Reply-To address that
 * embeds a signed token. When the recipient replies, the inbound webhook
 * pulls the token out of the To address, verifies the HMAC, and routes the
 * reply back into the right Order or RFQ thread.
 *
 * Address shape:
 *   reply+<kind>.<id>.<sig>@<INBOUND_EMAIL_DOMAIN>
 * where:
 *   kind = "o" for an Order thread, "q" for a Quote thread
 *   id   = the cuid of the Order or QuoteRequest
 *   sig  = the first 16 hex chars (64 bits) of HMAC-SHA256(secret, `${kind}.${id}`)
 *
 * The full token (`<kind>.<id>.<sig>`) keeps the local-part under RFC 5321's
 * 64-char limit (8 + 25-char cuid + 1 + 16 = 50) so providers like Resend
 * don't reject the Reply-To with a 422. 64 bits of HMAC is still strong
 * against forgery for a short-lived per-thread token.
 */

export type ThreadKind = "order" | "quote";

const KIND_CODE: Record<ThreadKind, string> = { order: "o", quote: "q" };
const KIND_FROM_CODE: Record<string, ThreadKind> = { o: "order", q: "quote" };

function secret(): string | null {
  const s = process.env.INBOUND_REPLY_SECRET;
  return s && s.length >= 16 ? s : null;
}

export function inboundProvider(): "resend" | "postmark" | "sendgrid" | null {
  const p = (process.env.INBOUND_EMAIL_PROVIDER || "").toLowerCase();
  if (p === "resend" || p === "postmark" || p === "sendgrid") return p;
  return null;
}

export function inboundDomain(): string {
  return (
    process.env.INBOUND_EMAIL_DOMAIN || "inbound.partsport.agentgaming.gg"
  );
}

export function isInboundConfigured(): boolean {
  return !!(secret() && inboundProvider());
}

function sign(kind: ThreadKind, id: string): string {
  const s = secret();
  if (!s) throw new Error("INBOUND_REPLY_SECRET is not set");
  return crypto
    .createHmac("sha256", s)
    .update(`${KIND_CODE[kind]}.${id}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Build the per-thread reply address. Returns null if inbound is not
 * configured (so callers can omit Reply-To gracefully).
 */
export function replyAddress(kind: ThreadKind, id: string): string | null {
  if (!isInboundConfigured()) return null;
  const sig = sign(kind, id);
  const local = `reply+${KIND_CODE[kind]}.${id}.${sig}`;
  // RFC 5321 caps the local-part at 64 octets. Resend rejects longer
  // Reply-To values with a 422. Bail loudly rather than ship a Reply-To
  // the provider will silently drop.
  if (local.length > 64) {
    throw new Error(
      `reply address local-part exceeds RFC 5321 64-char limit (${local.length})`
    );
  }
  return `${local}@${inboundDomain()}`;
}

export type ParsedReplyTarget = {
  kind: ThreadKind;
  id: string;
};

/**
 * Pull the thread out of the recipient address. Returns null on:
 *   - wrong domain
 *   - missing prefix
 *   - bad token shape
 *   - bad signature
 * Constant-time comparison on the signature; safe to call with attacker input.
 */
export function parseReplyAddress(
  rawAddress: string
): ParsedReplyTarget | null {
  if (!secret()) return null;
  const at = rawAddress.toLowerCase().trim();
  // Tolerate display-name wrappers like "PartsPort <reply+…@…>"
  const angled = at.match(/<([^>]+)>/);
  const addr = angled ? angled[1] : at;
  const [local, domain] = addr.split("@");
  if (!local || !domain) return null;
  if (domain !== inboundDomain().toLowerCase()) return null;
  if (!local.startsWith("reply+")) return null;
  const token = local.slice("reply+".length);
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [kindCode, id, sig] = parts;
  const kind = KIND_FROM_CODE[kindCode];
  if (!kind || !id || !sig) return null;
  const expected = sign(kind, id);
  // Length check before timingSafeEqual to avoid a throw on mismatch.
  if (expected.length !== sig.length) return null;
  const ok = crypto.timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(sig, "utf8")
  );
  if (!ok) return null;
  return { kind, id };
}

