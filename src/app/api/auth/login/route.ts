import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  const normalized = String(email || "").toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user || !(await verifyPassword(String(password || ""), user.passwordHash))) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }
  await createSession(user.id);
  return NextResponse.json({ ok: true, role: user.role });
}
