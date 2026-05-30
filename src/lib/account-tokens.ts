import "server-only";
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

/**
 * Issue + consume helpers for the AccountToken table. Pattern matches the
 * existing PasswordResetToken handling: random 32-byte token, SHA-256
 * stored at rest, the raw token only appears in the URL we email.
 */

export const TOKEN_TYPES = {
  EMAIL_CHANGE: "EMAIL_CHANGE",
  ACCOUNT_RECOVERY: "ACCOUNT_RECOVERY",
} as const;
export type TokenType = (typeof TOKEN_TYPES)[keyof typeof TOKEN_TYPES];

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Mint a new account token, persist its hash, and return the raw value
 * to include in the email URL. Any older unused tokens of the same type
 * for the same user are invalidated (used at the same instant) so a
 * stale link can't compete with the fresh one.
 */
export async function issueAccountToken(args: {
  userId: string;
  type: TokenType;
  payload?: Prisma.InputJsonValue;
  expiresInMs: number;
}): Promise<string> {
  const raw = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + args.expiresInMs);
  await prisma.accountToken.updateMany({
    where: { userId: args.userId, type: args.type, usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.accountToken.create({
    data: {
      userId: args.userId,
      type: args.type,
      tokenHash,
      payload: args.payload,
      expiresAt,
    },
  });
  return raw;
}

/** Look up and atomically consume a token. Returns the row or null. */
export async function consumeAccountToken(
  raw: string,
  type: TokenType
) {
  if (!raw) return null;
  const tokenHash = hashToken(raw);
  const row = await prisma.accountToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!row) return null;
  if (row.type !== type) return null;
  if (row.usedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  await prisma.accountToken.update({
    where: { id: row.id },
    data: { usedAt: new Date() },
  });
  return row;
}
