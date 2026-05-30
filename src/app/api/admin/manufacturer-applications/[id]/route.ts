import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";
import { rateLimit } from "@/lib/rate-limit";
import {
  sendOemApplicationApproved,
  sendOemApplicationRejected,
} from "@/lib/email";

export const runtime = "nodejs";

/**
 * PLH-3c F3: admin decision on a ManufacturerApplication. Approve writes
 * User.manufacturerName (the gate that surfaces the OEM in
 * listClaimedManufacturers, the storefront, and the supplier dropdown).
 * Reject stores a reason. Both paths audit-log + email the OEM.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const rl = await rateLimit("generic", `user:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429 }
    );
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const decision = String(body.decision || "").toUpperCase();
  const reason = String(body.reason || "").trim().slice(0, 300);

  if (decision !== "APPROVED" && decision !== "REJECTED") {
    return NextResponse.json(
      { error: "decision must be APPROVED or REJECTED." },
      { status: 400 }
    );
  }
  if (decision === "REJECTED" && !reason) {
    return NextResponse.json(
      { error: "A rejection reason is required." },
      { status: 400 }
    );
  }

  const app = await prisma.manufacturerApplication.findUnique({
    where: { id },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  if (!app) {
    return NextResponse.json(
      { error: "Application not found." },
      { status: 404 }
    );
  }
  if (app.status !== "PENDING") {
    return NextResponse.json(
      { error: "Application has already been reviewed." },
      { status: 400 }
    );
  }

  if (decision === "APPROVED") {
    // Conflict guard: another MANUFACTURER may have approved an
    // identically-named brand between submission and review.
    const conflict = await prisma.user.findFirst({
      where: {
        manufacturerName: { equals: app.manufacturerName, mode: "insensitive" },
        NOT: { id: app.userId },
      },
      select: { id: true },
    });
    if (conflict) {
      return NextResponse.json(
        {
          error: `"${app.manufacturerName}" is already claimed by another approved account. Reject this application or contact the OEM to pick a different name.`,
        },
        { status: 409 }
      );
    }
    await prisma.$transaction([
      prisma.user.update({
        where: { id: app.userId },
        data: { manufacturerName: app.manufacturerName },
      }),
      prisma.manufacturerApplication.update({
        where: { id },
        data: {
          status: "APPROVED",
          reviewedAt: new Date(),
          reviewedByUserId: user.id,
        },
      }),
    ]);
    await writeAuditLog({
      actor: user,
      action: "OEM_APPLICATION_APPROVED",
      targetType: "ManufacturerApplication",
      targetId: app.id,
      summary: `Approved OEM brand "${app.manufacturerName}" for ${app.user.email}`,
      metadata: { userId: app.userId, manufacturerName: app.manufacturerName },
    });
    after(async () => {
      try {
        await sendOemApplicationApproved({
          userEmail: app.user.email,
          userName: app.user.name,
          manufacturerName: app.manufacturerName,
        });
      } catch (err) {
        captureError(err, {
          subsystem: "email",
          op: "oem-application-approved",
          applicationId: app.id,
        });
      }
    });
    return NextResponse.json({ ok: true });
  }

  // REJECTED
  await prisma.manufacturerApplication.update({
    where: { id },
    data: {
      status: "REJECTED",
      reviewedAt: new Date(),
      reviewedByUserId: user.id,
      rejectionReason: reason,
    },
  });
  await writeAuditLog({
    actor: user,
    action: "OEM_APPLICATION_REJECTED",
    targetType: "ManufacturerApplication",
    targetId: app.id,
    summary: `Rejected OEM brand "${app.manufacturerName}" for ${app.user.email}: ${reason}`,
    metadata: { userId: app.userId, manufacturerName: app.manufacturerName, reason },
  });
  after(async () => {
    try {
      await sendOemApplicationRejected({
        userEmail: app.user.email,
        userName: app.user.name,
        manufacturerName: app.manufacturerName,
        reason,
      });
    } catch (err) {
      captureError(err, {
        subsystem: "email",
        op: "oem-application-rejected",
        applicationId: app.id,
      });
    }
  });
  return NextResponse.json({ ok: true });
}
