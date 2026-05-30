import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import {
  getCurrentUser,
  hashPassword,
  createSession,
} from "@/lib/auth";

export const runtime = "nodejs";

async function loadInvite(token: string) {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return prisma.supplierInvite.findUnique({
    where: { tokenHash },
    include: { supplier: true },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const invite = await loadInvite(token);
  if (!invite) return NextResponse.json({ error: "Invite not found." }, { status: 404 });
  if (invite.acceptedAt) {
    return NextResponse.json(
      { error: "This invite has already been used." },
      { status: 400 }
    );
  }
  if (invite.expiresAt < new Date()) {
    return NextResponse.json({ error: "This invite has expired." }, { status: 400 });
  }
  const me = await getCurrentUser();
  const existingUser = await prisma.user.findUnique({
    where: { email: invite.email },
    select: { id: true, name: true },
  });
  return NextResponse.json({
    ok: true,
    email: invite.email,
    role: invite.role,
    companyName: invite.supplier.name,
    expiresAt: invite.expiresAt.toISOString(),
    signedIn: !!me,
    signedInAs: me?.email,
    existingUser: !!existingUser,
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const invite = await loadInvite(token);
  if (!invite) return NextResponse.json({ error: "Invite not found." }, { status: 404 });
  if (invite.acceptedAt) {
    return NextResponse.json(
      { error: "This invite has already been used." },
      { status: 400 }
    );
  }
  if (invite.expiresAt < new Date()) {
    return NextResponse.json({ error: "This invite has expired." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const wantsRegister = Boolean(body.register);
  const me = await getCurrentUser();
  let userId: string;

  if (me) {
    // Signed-in user accepting. Email must match invite or they explicitly
    // confirm the swap. To keep it simple, just check the emails match.
    if (me.email.toLowerCase() !== invite.email.toLowerCase()) {
      return NextResponse.json(
        {
          error: `This invite was sent to ${invite.email}. Sign in with that email to accept.`,
        },
        { status: 403 }
      );
    }
    userId = me.id;
    if (me.role === "BUYER") {
      await prisma.user.update({
        where: { id: me.id },
        data: { role: "SUPPLIER" },
      });
    }
  } else if (wantsRegister) {
    const name = String(body.name || "").trim();
    const password = String(body.password || "");
    if (!name || password.length < 8) {
      return NextResponse.json(
        { error: "Name and an 8+ character password are required." },
        { status: 400 }
      );
    }
    const existing = await prisma.user.findUnique({ where: { email: invite.email } });
    if (existing) {
      return NextResponse.json(
        { error: "An account already exists for this email. Please sign in instead." },
        { status: 400 }
      );
    }
    const user = await prisma.user.create({
      data: {
        email: invite.email,
        name,
        passwordHash: await hashPassword(password),
        role: "SUPPLIER",
      },
    });
    userId = user.id;
    await createSession(user.id);
  } else {
    return NextResponse.json({ error: "Sign in or register to accept." }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.supplierMember.create({
      data: {
        supplierId: invite.supplierId,
        userId,
        role: invite.role,
      },
    }),
    prisma.supplierInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
