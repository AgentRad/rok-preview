import { NextResponse } from "next/server";
import crypto from "node:crypto";
import type { SupplierMemberRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  canManageTeam,
  getSupplierContextForUser,
} from "@/lib/supplier-access";
import { sendSupplierInvite } from "@/lib/email";
import { siteUrl } from "@/lib/site-url";

export const runtime = "nodejs";

const INVITE_DAYS = 14;

const VALID_ROLES: SupplierMemberRole[] = [
  "OWNER",
  "ADMIN",
  "SALES",
  "FULFILLMENT",
  "CATALOG",
  "FINANCE",
  "VIEWER",
];

function parseRole(input: unknown): SupplierMemberRole {
  if (typeof input !== "string") return "ADMIN";
  const upper = input.toUpperCase() as SupplierMemberRole;
  return VALID_ROLES.includes(upper) ? upper : "ADMIN";
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const ctx = await getSupplierContextForUser(user.id);
  if (!ctx) {
    return NextResponse.json({ error: "No supplier access." }, { status: 403 });
  }

  const [members, invites] = await Promise.all([
    prisma.supplierMember.findMany({
      where: { supplierId: ctx.supplier.id },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    }),
    prisma.supplierInvite.findMany({
      where: { supplierId: ctx.supplier.id, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return NextResponse.json({
    role: ctx.role,
    canManageTeam: canManageTeam(ctx.role),
    members: members.map((m) => ({
      id: m.id,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
      user: m.user,
    })),
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt.toISOString(),
    })),
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const ctx = await getSupplierContextForUser(user.id);
  if (!ctx || !canManageTeam(ctx.role)) {
    return NextResponse.json(
      { error: "Only the supplier owner can invite team members." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").toLowerCase().trim();
  const role = parseRole(body.role);
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  // Existing user? Add the membership immediately.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const already = await prisma.supplierMember.findUnique({
      where: {
        supplierId_userId: { supplierId: ctx.supplier.id, userId: existing.id },
      },
    });
    if (already) {
      return NextResponse.json(
        { error: "This user is already on the team." },
        { status: 400 }
      );
    }
    await prisma.$transaction([
      prisma.user.update({
        where: { id: existing.id },
        // Promote BUYER -> SUPPLIER so they can sign in to the supplier dashboard.
        data: existing.role === "BUYER" ? { role: "SUPPLIER" } : {},
      }),
      prisma.supplierMember.create({
        data: { supplierId: ctx.supplier.id, userId: existing.id, role },
      }),
    ]);
    sendSupplierInvite({
      to: existing.email,
      inviterName: user.name,
      companyName: ctx.supplier.name,
      acceptUrl: siteUrl(`/supplier`),
      expiresDays: INVITE_DAYS,
    }).catch((err) =>
      console.error("[email] supplier-invite (existing user) failed:", err)
    );
    return NextResponse.json({ ok: true, added: "existing-user" });
  }

  // New email: create a pending invite with a hashed token.
  const raw = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);

  await prisma.supplierInvite.create({
    data: {
      supplierId: ctx.supplier.id,
      email,
      role,
      tokenHash,
      invitedById: user.id,
      expiresAt,
    },
  });

  const acceptUrl = siteUrl(`/invite/${raw}`);
  sendSupplierInvite({
    to: email,
    inviterName: user.name,
    companyName: ctx.supplier.name,
    acceptUrl,
    expiresDays: INVITE_DAYS,
  }).catch((err) =>
    console.error("[email] supplier-invite (new user) failed:", err)
  );

  return NextResponse.json({ ok: true, added: "pending-invite", expiresAt });
}
