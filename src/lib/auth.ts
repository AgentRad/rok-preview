import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { Role, User } from "@prisma/client";
import { prisma } from "./db";
import { isSessionTokenPayload } from "./route-guards";

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

// BUG (CRITICAL) defense-in-depth: the pre-2FA "ticket" used to be signed with
// the SAME key as real session cookies, so a leaked/copied ticket verified as a
// session. Sign the ticket with a domain-separated key derived from the session
// secret (no new env var required). A token signed for one purpose cannot be
// verified for the other, even if the kind-claim check were ever removed.
let cachedTicketSecret: Uint8Array | null = null;
export function getTicketSecret(): Uint8Array {
  if (cachedTicketSecret) return cachedTicketSecret;
  const base = resolveSessionSecret();
  const label = new TextEncoder().encode(".2fa-pending-ticket.v1");
  const combined = new Uint8Array(base.length + label.length);
  combined.set(base, 0);
  combined.set(label, base.length);
  cachedTicketSecret = combined;
  return cachedTicketSecret;
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

const DEFAULT_SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

/**
 * PLH-3y-4: optional SSO session shaping. When a user signs in through an org's
 * SSO, the session is capped at min(30d, SsoConfig.sessionMaxAgeMin) and carries
 * `sso`/`org` claims so middleware and later rounds can re-enforce. Password
 * logins pass no opts and keep the 30-day default.
 */
export type SessionOptions = {
  maxAgeSec?: number;
  sso?: boolean;
  org?: string;
};

export async function createSession(
  userId: string,
  opts: SessionOptions = {}
): Promise<void> {
  // PLH-1: stamp the session with the user's current sessionsValidFrom so
  // password changes, 2FA disable, email change, and account deletion can
  // invalidate every outstanding cookie by bumping that field.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { sessionsValidFrom: true },
  });
  const svf = user?.sessionsValidFrom?.getTime() ?? Date.now();
  const maxAgeSec = Math.min(
    DEFAULT_SESSION_MAX_AGE_SEC,
    Math.max(60, opts.maxAgeSec ?? DEFAULT_SESSION_MAX_AGE_SEC)
  );
  const claims: Record<string, unknown> = { uid: userId, svf };
  if (opts.sso) claims.sso = true;
  if (opts.org) claims.org = opts.org;
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSec}s`)
    .sign(resolveSessionSecret());

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    // Secure in production. ALLOW_INSECURE_COOKIES=1 relaxes this ONLY for the
    // CI e2e job, which serves the production build over http://localhost where
    // a Secure cookie cannot be stored. Vercel never sets this env, so real
    // production is always Secure.
    secure: process.env.NODE_ENV === "production" && process.env.ALLOW_INSECURE_COOKIES !== "1",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSec,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
  // PLH-1 commit 2: drop the admin impersonation cookie too. Otherwise a
  // signed-out admin can leave the "acting as" cookie behind which then
  // attaches to whoever next signs in on that browser.
  store.delete("pp_acting_as");
}

export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, resolveSessionSecret());
    // BUG (CRITICAL): reject anything that is not a true session token. A real
    // session JWT (createSession) carries no kind claim; the 2FA-pending ticket
    // carries kind:"2fa-pending". Without this, that ticket worked as a full
    // session and the second factor was skipped entirely.
    if (!isSessionTokenPayload(payload)) return null;
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
