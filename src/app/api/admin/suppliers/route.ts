import { NextResponse } from "next/server";
import crypto from "node:crypto";
import type { SupplierMemberRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { sendSupplierWelcome, sendSupplierInvite } from "@/lib/email";
import { siteUrl } from "@/lib/site-url";

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

const INVITE_DAYS = 14;

export const runtime = "nodejs";

/**
 * Admin-only direct-create of a supplier and its owner user. Skips the public
 * application + approval flow when the admin already has the supplier's info
 * (typical for the launch pilot: the owner is onboarding suppliers they know).
 */
export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const companyName = String(body.companyName || "").trim();
  const contactName = String(body.contactName || "").trim();
  const contactEmail = String(body.contactEmail || "").toLowerCase().trim();
  const certifications = String(body.certifications || "").trim();
  const website = String(body.website || "").trim();
  const description = String(body.description || "").trim();
  const logoUrl = String(body.logoUrl || "").trim();
  const sendEmail = body.sendEmail !== false; // default true
  const teammates = Array.isArray(body.invites)
    ? (body.invites as Array<{ email?: string; role?: string }>).filter(
        (t) => t && typeof t.email === "string" && t.email.includes("@")
      )
    : [];

  if (!companyName) {
    return NextResponse.json({ error: "Company name is required." }, { status: 400 });
  }
  if (!contactEmail) {
    return NextResponse.json(
      { error: "Owner email is required." },
      { status: 400 }
    );
  }
  if (!contactName) {
    return NextResponse.json(
      { error: "Owner full name is required." },
      { status: 400 }
    );
  }

  // Reuse an existing user with this email if it already exists; otherwise
  // create one with a generated temp password.
  const existing = await prisma.user.findUnique({ where: { email: contactEmail } });
  let tempPassword: string | null = null;
  let user;
  if (existing) {
    user = await prisma.user.update({
      where: { id: existing.id },
      data: { role: "SUPPLIER" },
    });
  } else {
    tempPassword = crypto.randomBytes(6).toString("base64url").slice(0, 10);
    user = await prisma.user.create({
      data: {
        email: contactEmail,
        name: contactName,
        role: "SUPPLIER",
        passwordHash: await hashPassword(tempPassword),
      },
    });
  }

  // Don't allow a second supplier on the same primary user.
  if (existing) {
    const owned = await prisma.supplier.findUnique({ where: { userId: user.id } });
    if (owned) {
      return NextResponse.json(
        {
          error: `${owned.name} is already linked to ${user.email}. Use the team invite flow to add this user to another supplier.`,
        },
        { status: 400 }
      );
    }
  }

  const supplier = await prisma.supplier.create({
    data: {
      name: companyName,
      contactEmail,
      status: "APPROVED",
      certifications,
      website,
      description,
      logoUrl: logoUrl || null,
      userId: user.id,
    },
  });

  await prisma.supplierMember.create({
    data: { supplierId: supplier.id, userId: user.id, role: "OWNER" },
  });

  if (sendEmail) {
    sendSupplierWelcome({
      to: user.email,
      contactName: user.name,
      companyName: supplier.name,
      tempPassword,
    }).catch((err) =>
      console.error("[email] supplier-welcome failed:", err)
    );
  }

  // Optional teammate invites at creation time. Existing PartsPort users are
  // added as SupplierMember immediately; new emails get a one-time-token
  // invite link. Anything malformed is dropped silently (we only filter out
  // entries without an email; bad emails just won't resolve to a user).
  const inviteSummary: Array<{
    email: string;
    role: SupplierMemberRole;
    status: "added" | "invited" | "skipped-self";
  }> = [];
  for (const t of teammates) {
    const email = String(t.email).toLowerCase().trim();
    if (!email) continue;
    if (email === contactEmail) {
      inviteSummary.push({ email, role: "OWNER", status: "skipped-self" });
      continue;
    }
    const role = parseRole(t.role);
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const already = await prisma.supplierMember.findUnique({
        where: {
          supplierId_userId: {
            supplierId: supplier.id,
            userId: existingUser.id,
          },
        },
      });
      if (!already) {
        await prisma.$transaction([
          prisma.user.update({
            where: { id: existingUser.id },
            data: existingUser.role === "BUYER" ? { role: "SUPPLIER" } : {},
          }),
          prisma.supplierMember.create({
            data: { supplierId: supplier.id, userId: existingUser.id, role },
          }),
        ]);
      }
      sendSupplierInvite({
        to: email,
        inviterName: me.name,
        companyName: supplier.name,
        acceptUrl: siteUrl(`/supplier`),
        expiresDays: INVITE_DAYS,
      }).catch((err) =>
        console.error("[email] team-invite (existing) failed:", err)
      );
      inviteSummary.push({ email, role, status: "added" });
    } else {
      const raw = crypto.randomBytes(32).toString("base64url");
      const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
      const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
      await prisma.supplierInvite.create({
        data: {
          supplierId: supplier.id,
          email,
          role,
          tokenHash,
          invitedById: me.id,
          expiresAt,
        },
      });
      sendSupplierInvite({
        to: email,
        inviterName: me.name,
        companyName: supplier.name,
        acceptUrl: siteUrl(`/invite/${raw}`),
        expiresDays: INVITE_DAYS,
      }).catch((err) =>
        console.error("[email] team-invite (new) failed:", err)
      );
      inviteSummary.push({ email, role, status: "invited" });
    }
  }

  return NextResponse.json({
    ok: true,
    supplierId: supplier.id,
    userId: user.id,
    tempPassword, // shown to admin once; not stored
    invites: inviteSummary,
  });
}
