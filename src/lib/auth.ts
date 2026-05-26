import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { Role, User } from "@prisma/client";
import { prisma } from "./db";

const COOKIE = "pp_session";

// PLH-1: SESSION_SECRET hardening. In production we refuse to serve a
// request with a weak/missing secret. We evaluate lazily on first use so
// `next build` (which loads route modules to collect page data) doesn't
// crash on the build host before runtime env vars are present. Vercel
// always sets SESSION_SECRET at runtime; the build still runs with
// NODE_ENV=production but may not have the runtime secret available.
let cachedSecret: Uint8Array | null = null;
function resolveSessionSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  const value = process.env.SESSION_SECRET;
  const isProd =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production";
  if (isProd) {
    if (!value || value.length < 32) {
      throw new Error(
        "SESSION_SECRET must be set to at least 32 characters in production."
      );
    }
    cachedSecret = new TextEncoder().encode(value);
    return cachedSecret;
  }
  cachedSecret = new TextEncoder().encode(
    value || "insecure-dev-secret-please-override-in-prod"
  );
  return cachedSecret;
}

/** Shared accessor so other auth routes use the exact same secret. */
export function getSessionSecret(): Uint8Array {
  return resolveSessionSecret();
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function createSession(userId: string): Promise<void> {
  // PLH-1: stamp the session with the user's current sessionsValidFrom so
  // password changes, 2FA disable, email change, and account deletion can
  // invalidate every outstanding cookie by bumping that field.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { sessionsValidFrom: true },
  });
  const svf = user?.sessionsValidFrom?.getTime() ?? Date.now();
  const token = await new SignJWT({ uid: userId, svf })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(resolveSessionSecret());

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, resolveSessionSecret());
    const uid = payload.uid as string;
    if (!uid) return null;
    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (!user) return null;
    // PLH-1: reject sessions issued before the user's sessionsValidFrom or
    // belonging to soft-deleted accounts.
    if (user.deletedAt) return null;
    const iat = typeof payload.iat === "number" ? payload.iat : 0;
    const issuedAtMs = iat * 1000;
    if (user.sessionsValidFrom.getTime() > issuedAtMs) return null;
    return user;
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(role: Role): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== role && user.role !== "ADMIN") redirect("/");
  return user;
}
