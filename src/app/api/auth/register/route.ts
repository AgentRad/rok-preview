import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";

export async function POST(req: Request) {
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
    },
  });
  await createSession(user.id);
  return NextResponse.json({ ok: true, role: user.role });
}
