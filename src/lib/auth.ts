import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { Role, User } from "@prisma/client";
import { prisma } from "./db";

const COOKIE = "pp_session";
const secret = new TextEncoder().encode(
  process.env.SESSION_SECRET || "insecure-dev-secret-please-override-in-prod"
);

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function createSession(userId: string): Promise<void> {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);

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
    const { payload } = await jwtVerify(token, secret);
    const uid = payload.uid as string;
    if (!uid) return null;
    return await prisma.user.findUnique({ where: { id: uid } });
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
