import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { sendApplicationStatus } from "@/lib/email";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";

const TEMP_PASSWORD = "demo1234";

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
    const account = existingUser
      ? await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            role,
            ...(isOem ? { manufacturerName: app.companyName } : {}),
          },
        })
      : await prisma.user.create({
          data: {
            email: app.email,
            name: app.contactName,
            role,
            passwordHash: await hashPassword(TEMP_PASSWORD),
            ...(isOem ? { manufacturerName: app.companyName } : {}),
          },
        });

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
    after(async () => {
      try {
        await sendApplicationStatus({
          to: app.email,
          contactName: app.contactName,
          companyName: app.companyName,
          approved: true,
          tempPassword: existingUser ? null : TEMP_PASSWORD,
        });
      } catch (err) {
        captureError(err, { subsystem: "email", op: "application-approved", applicationId: app.id });
      }
    });
    return NextResponse.json({
      ok: true,
      loginEmail: app.email,
      tempPassword: existingUser ? null : TEMP_PASSWORD,
    });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
