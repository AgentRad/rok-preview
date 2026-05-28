import "server-only";
import crypto from "node:crypto";
import { TOTP, Secret } from "otpauth";

/**
 * Time-based one-time passwords (RFC 6238). 6-digit codes, 30-second window,
 * 1-step skew tolerated (matches Google Authenticator, Authy, 1Password, etc).
 */

const ISSUER = "PartsPort";

export function generateSecret(): string {
  // 160-bit secret encoded as base32. Standard for Google Authenticator.
  return new Secret({ size: 20 }).base32;
}

export function totpUrl(args: {
  secret: string;
  accountName: string;
}): string {
  const totp = new TOTP({
    issuer: ISSUER,
    label: args.accountName,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(args.secret),
  });
  return totp.toString();
}

export function verifyTotp(secret: string, code: string): boolean {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  try {
    const totp = new TOTP({
      issuer: ISSUER,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    });
    const delta = totp.validate({ token: normalized, window: 1 });
    return delta !== null;
  } catch {
    return false;
  }
}

/** Returns 8 backup codes, each 10 characters (5+5 with dash). */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  for (let i = 0; i < 8; i++) {
    let s = "";
    for (let j = 0; j < 10; j++) {
      s += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
    }
    codes.push(`${s.slice(0, 5)}-${s.slice(5)}`);
  }
  return codes;
}

export function hashBackupCode(code: string): string {
  const normalized = code.replace(/\s+/g, "").toUpperCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}
