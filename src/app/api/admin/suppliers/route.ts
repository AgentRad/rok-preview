import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { sendSupplierWelcome } from "@/lib/email";

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
  const sendEmail = body.sendEmail !== false; // default true

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

  return NextResponse.json({
    ok: true,
    supplierId: supplier.id,
    userId: user.id,
    tempPassword, // shown to admin once; not stored
  });
}
