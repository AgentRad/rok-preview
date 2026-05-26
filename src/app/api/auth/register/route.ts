import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { issueEmailVerification } from "@/lib/email-verification";

export async function POST(req: Request) {
  const ip = clientIp(req);
  // Burst limit: at most 1 registration per minute from one IP. Catches
  // rapid-fire bot signup; humans never hit this.
  const burst = await rateLimit("register:burst", ip);
  if (!burst.allowed) {
    return NextResponse.json(
      { error: "Slow down. Wait a minute before trying again." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(burst.retryAfterMs / 1000)) },
      }
    );
  }
  // Hourly limit: 3 per hour per IP for the slower, more methodical bots.
  const limit = await rateLimit("register", ip);
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
  const pwLen = String(password || "").length;
  if (!name || !email || !password || pwLen < 8 || pwLen > 128) {
    return NextResponse.json(
      { error: "Name, email and a password between 8 and 128 characters are required." },
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
