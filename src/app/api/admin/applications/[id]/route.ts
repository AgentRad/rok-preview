import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hashPassword } from "@/lib/auth";

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
    return NextResponse.json({ ok: true });
  }

  if (action === "approve") {
    const existingUser = await prisma.user.findUnique({
      where: { email: app.email },
    });
    const supplierUser = existingUser
      ? await prisma.user.update({
          where: { id: existingUser.id },
          data: { role: "SUPPLIER" },
        })
      : await prisma.user.create({
          data: {
            email: app.email,
            name: app.contactName,
            role: "SUPPLIER",
            passwordHash: await hashPassword(TEMP_PASSWORD),
          },
        });

    await prisma.supplier.create({
      data: {
        name: app.companyName,
        contactEmail: app.email,
        status: "APPROVED",
        certifications: app.certs,
        rating: 4.7,
        reviews: 0,
        userId: supplierUser.id,
      },
    });
    await prisma.supplierApplication.update({
      where: { id },
      data: { status: "APPROVED" },
    });
    return NextResponse.json({
      ok: true,
      loginEmail: app.email,
      tempPassword: existingUser ? null : TEMP_PASSWORD,
    });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
