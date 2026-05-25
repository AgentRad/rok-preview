import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { issueEmailVerification } from "@/lib/email-verification";

export async function POST(req: Request) {
  const limit = await rateLimit("register", clientIp(req));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many sign-up attempts. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
      }
    );
  }
  const { name, email, password } = await req.json().catch(() => ({}));
  if (!name || !email || !password || String(password).length < 6) {
    return NextResponse.json(
      { error: "Name, email and a password of at least 6 characters are required." },
      { status: 400 }
    );
  }
  const normalized = String(email).toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with that email already exists." },
      { status: 409 }
    );
  }
  const user = await prisma.user.create({
    data: {
      name: String(name).trim(),
      email: normalized,
      passwordHash: await hashPassword(String(password)),
      role: "BUYER",
      // emailVerified starts null; user clicks the link in the welcome
      // email to flip it. State-changing endpoints (orders, listings)
      // gate on isEmailVerified().
    },
  });
  await createSession(user.id);
  // Awaited so the email is guaranteed to fire before the response returns;
  // see HABITS.md on Vercel killing the function after the response.
  await issueEmailVerification({
    userId: user.id,
    email: user.email,
    name: user.name,
  });
  return NextResponse.json({
    ok: true,
    role: user.role,
    verificationRequired: true,
  });
}
