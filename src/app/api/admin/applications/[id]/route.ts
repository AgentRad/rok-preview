import { NextResponse, after } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import {
  sendApplicationStatus,
  sendNewSupplierWelcome,
} from "@/lib/email";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";
import { issuePasswordResetUrl } from "@/lib/password-reset";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const { id } = await params;
  const { action } = await req.json().catch(() => ({}));
  const app = await prisma.supplierApplication.findUnique({ where: { id } });
  if (!app) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }
  if (app.status !== "PENDING") {
    return NextResponse.json(
      { error: "Application has already been reviewed." },
      { status: 400 }
    );
  }

  if (action === "reject") {
    await prisma.supplierApplication.update({
      where: { id },
      data: { status: "REJECTED" },
    });
    await writeAuditLog({
      actor: user,
      action: "SUPPLIER_REJECTED",
      targetType: "SupplierApplication",
      targetId: app.id,
      summary: `Rejected application from ${app.companyName} (${app.email})`,
      metadata: { category: app.category },
    });
    after(async () => {
      try {
        await sendApplicationStatus({
          to: app.email,
          contactName: app.contactName,
          companyName: app.companyName,
          approved: false,
        });
      } catch (err) {
        captureError(err, { subsystem: "email", op: "application-rejected", applicationId: app.id });
      }
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "approve") {
    const isOem = app.category === "Manufacturer / OEM";
    const role = isOem ? "MANUFACTURER" : "SUPPLIER";
    const existingUser = await prisma.user.findUnique({
      where: { email: app.email },
    });
    // PLH-1 commit 3: no shared "demo1234" temp password. New accounts get
    // a random 32-byte secret which is bcrypt-hashed and then thrown away.
    // The user sets a real password by clicking through the reset link in
    // the welcome email below.
    let isNewAccount = false;
    const account = existingUser
      ? await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            role,
            ...(isOem ? { manufacturerName: app.companyName } : {}),
          },
        })
      : await (async () => {
          isNewAccount = true;
          const throwaway = crypto.randomBytes(32).toString("hex");
          const passwordHash = await hashPassword(throwaway);
          return prisma.user.create({
            data: {
              email: app.email,
              name: app.contactName,
              role,
              passwordHash,
              ...(isOem ? { manufacturerName: app.companyName } : {}),
            },
          });
        })();

    if (!isOem) {
      const supplier = await prisma.supplier.create({
        data: {
          name: app.companyName,
          contactEmail: app.email,
          status: "APPROVED",
          certifications: app.certs,
          rating: 4.7,
          reviews: 0,
          userId: account.id,
        },
      });
      await prisma.supplierMember.create({
        data: {
          supplierId: supplier.id,
          userId: account.id,
          role: "OWNER",
        },
      });
    }
    await prisma.supplierApplication.update({
      where: { id },
      data: { status: "APPROVED" },
    });
    await writeAuditLog({
      actor: user,
      action: "SUPPLIER_APPROVED",
      targetType: "SupplierApplication",
      targetId: app.id,
      summary: `Approved application from ${app.companyName} (${app.email}) as ${role}`,
      metadata: { category: app.category, role, userId: account.id },
    });

    // Mint a password-reset link for new accounts. Existing accounts keep
    // their existing password.
    let setPasswordLink: string | null = null;
    if (isNewAccount) {
      setPasswordLink = await issuePasswordResetUrl(account.id);
    }

    after(async () => {
      try {
        if (isNewAccount && setPasswordLink) {
          await sendNewSupplierWelcome({
            to: app.email,
            name: app.contactName,
            setPasswordLink,
          });
        } else {
          await sendApplicationStatus({
            to: app.email,
            contactName: app.contactName,
            companyName: app.companyName,
            approved: true,
            tempPassword: null,
          });
        }
      } catch (err) {
        captureError(err, { subsystem: "email", op: "application-approved", applicationId: app.id });
      }
    });
    return NextResponse.json({
      ok: true,
      loginEmail: app.email,
    });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
