import "server-only";
import { createHmac } from "crypto";

const REPLY_TOKEN_VERSION = "1";

export function isInboundEmailConfigured(): boolean {
  return !!process.env.INBOUND_EMAIL_PROVIDER && !!process.env.INBOUND_REPLY_SECRET;
}

export function getInboundEmailDomain(): string {
  return process.env.INBOUND_EMAIL_DOMAIN || "inbound.partsport.agentgaming.gg";
}

export function buildReplyAddress(kind: string, id: string): string | null {
  const secret = process.env.INBOUND_REPLY_SECRET;
  if (!secret) return null;

  const domain = getInboundEmailDomain();
  const data = `${REPLY_TOKEN_VERSION}:${kind}:${id}`;
  const sig = createHmac("sha256", secret).update(data).digest("hex");
  return `reply+${kind}.${id}.${sig}@${domain}`;
}

export function parseReplyAddress(
  address: string,
  secret: string
): { kind: string; id: string } | null {
  const match = address.match(/^reply\+([^.]+)\.([^.]+)\.([^@]+)@/);
  if (!match) return null;

  const [, kind, id, sig] = match;
  const data = `${REPLY_TOKEN_VERSION}:${kind}:${id}`;
  const expectedSig = createHmac("sha256", secret).update(data).digest("hex");

  // Constant-time comparison to prevent timing attacks
  if (!constantTimeEquals(sig, expectedSig)) {
    return null;
  }

  return { kind, id };
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function stripQuotedReply(body: string): string {
  const lines = body.split("\n");
  let result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Stop at common quote markers
    if (
      line.match(/^On\s+.*?wrote:/i) || // Gmail: "On Mon, May 20, 2024 at 3:00 PM User wrote:"
      line.match(/^From:\s*/) || // Standard
      line.match(/^--\s*$/) || // Double-dash separator
      line.match(/^>\s*/) // Email quote marker
    ) {
      break;
    }

    // Skip mobile signature footers
    if (line.match(/^Sent from my|^Get Outlook|^__________________/)) {
      break;
    }

    result.push(line);
  }

  // Trim trailing whitespace and empty lines
  while (result.length > 0 && !result[result.length - 1]?.trim()) {
    result.pop();
  }

  return result.join("\n").trim();
}
