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
    // PLH-3e F3: wrap the approve-write set in a $transaction so a
    // concurrent second POST on the same application cannot create
    // duplicate Supplier/SupplierMember rows. Re-read the application
    // INSIDE the transaction and abort 409 if some other writer already
    // flipped it out of PENDING.
    let isNewAccount = false;
    let account: { id: string };
    try {
      const result = await prisma.$transaction(async (tx) => {
        const fresh = await tx.supplierApplication.findUnique({ where: { id } });
        if (!fresh || fresh.status !== "PENDING") {
          throw new Error("ALREADY_REVIEWED");
        }
        const existingUser = await tx.user.findUnique({
          where: { email: app.email },
        });
        // PLH-1 commit 3: no shared "demo1234" temp password. New accounts get
        // a random 32-byte secret which is bcrypt-hashed and then thrown away.
        // The user sets a real password by clicking through the reset link in
        // the welcome email below.
        const acct = existingUser
          ? await tx.user.update({
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
              return tx.user.create({
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
          const supplier = await tx.supplier.create({
            data: {
              name: app.companyName,
              contactEmail: app.email,
              status: "APPROVED",
              certifications: app.certs,
              rating: 4.7,
              reviews: 0,
              userId: acct.id,
            },
          });
          await tx.supplierMember.create({
            data: {
              supplierId: supplier.id,
              userId: acct.id,
              role: "OWNER",
            },
          });
        }
        await tx.supplierApplication.update({
          where: { id },
          data: { status: "APPROVED" },
        });
        return { acct };
      });
      account = result.acct;
    } catch (err) {
      if ((err as Error).message === "ALREADY_REVIEWED") {
        return NextResponse.json(
          { error: "Application has already been reviewed." },
          { status: 409 }
        );
      }
      throw err;
    }

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
