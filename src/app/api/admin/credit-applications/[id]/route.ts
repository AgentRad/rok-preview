import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import {
  sendCreditApplicationApproved,
  sendCreditApplicationRejected,
} from "@/lib/email";
import type { PaymentTerms } from "@prisma/client";

export const runtime = "nodejs";

const VALID_TERMS: PaymentTerms[] = ["NET_15", "NET_30", "NET_60"];

/**
 * PLH-3z-3: site admin approves or rejects a net-terms credit application.
 *
 * Approve (inside a $transaction): re-read the application is still PENDING,
 * set the org's paymentTerms + creditLimitCents from the approved values
 * (admin may downgrade the requested limit/terms), flip the application
 * APPROVED, stamp reviewedBy/reviewedAt + approved values. Reject: flip
 * REJECTED with a required reason. Both audit + email the AP contact.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "").toLowerCase();

  const app = await prisma.creditApplication.findUnique({ where: { id } });
  if (!app) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }
  if (app.status !== "PENDING") {
    return NextResponse.json(
      { error: `Application already ${app.status.toLowerCase()}.` },
      { status: 409 }
    );
  }

  if (action === "approve") {
    if (!app.orgId) {
      return NextResponse.json(
        { error: "Application has no organization. Prospect applications are not supported this round." },
        { status: 400 }
      );
    }
    const approvedTerms = String(body.approvedTerms || app.requestedTerms).toUpperCase() as PaymentTerms;
    if (!VALID_TERMS.includes(approvedTerms)) {
      return NextResponse.json(
        { error: "Approved terms must be NET_15, NET_30, or NET_60." },
        { status: 400 }
      );
    }
    const limitDollars = Number(body.approvedLimitDollars);
    if (!Number.isFinite(limitDollars) || limitDollars <= 0) {
      return NextResponse.json(
        { error: "Approved credit limit must be a positive number." },
        { status: 400 }
      );
    }
    const approvedLimitCents = Math.round(limitDollars * 100);
    const note = body.reviewerNote ? String(body.reviewerNote).trim().slice(0, 2000) : "";

    const org = await prisma.buyerOrg.findUnique({ where: { id: app.orgId } });
    if (!org) {
      return NextResponse.json({ error: "Organization not found." }, { status: 404 });
    }

    try {
      await prisma.$transaction(async (tx) => {
        const fresh = await tx.creditApplication.findUnique({ where: { id } });
        if (!fresh || fresh.status !== "PENDING") {
          throw new Error("ALREADY_REVIEWED");
        }
        await tx.buyerOrg.update({
          where: { id: app.orgId! },
          data: { paymentTerms: approvedTerms, creditLimitCents: approvedLimitCents },
        });
        await tx.creditApplication.update({
          where: { id },
          data: {
            status: "APPROVED",
            reviewedBy: user.id,
            reviewedAt: new Date(),
            reviewerNote: note,
            approvedTerms,
            approvedLimitCents,
          },
        });
      });
    } catch (e) {
      if (e instanceof Error && e.message === "ALREADY_REVIEWED") {
        return NextResponse.json(
          { error: "Application already reviewed." },
          { status: 409 }
        );
      }
      throw e;
    }

    await writeAuditLog({
      actor: user,
      action: "CREDIT_APP_APPROVED",
      targetType: "CreditApplication",
      targetId: id,
      summary: `Credit application ${app.reference} approved for ${org.name}: ${approvedTerms}, $${(approvedLimitCents / 100).toFixed(2)} limit`,
      metadata: { orgId: app.orgId, approvedTerms, approvedLimitCents },
    });

    const termsLabel = approvedTerms.replace("NET_", "Net ");
    await sendCreditApplicationApproved({
      to: app.apContactEmail,
      contactName: app.apContactName,
      orgName: org.name,
      termsLabel,
      limitDollars: (approvedLimitCents / 100).toFixed(2),
    }).catch(() => {});

    return NextResponse.json({ ok: true, status: "APPROVED" });
  }

  if (action === "reject") {
    const note = String(body.reviewerNote || "").trim();
    if (!note) {
      return NextResponse.json(
        { error: "A reason is required to reject an application." },
        { status: 400 }
      );
    }
    await prisma.creditApplication.update({
      where: { id },
      data: {
        status: "REJECTED",
        reviewedBy: user.id,
        reviewedAt: new Date(),
        reviewerNote: note.slice(0, 2000),
      },
    });
    const org = app.orgId
      ? await prisma.buyerOrg.findUnique({ where: { id: app.orgId } })
      : null;
    await writeAuditLog({
      actor: user,
      action: "CREDIT_APP_REJECTED",
      targetType: "CreditApplication",
      targetId: id,
      summary: `Credit application ${app.reference} rejected${org ? ` for ${org.name}` : ""}`,
      metadata: { orgId: app.orgId, reason: note.slice(0, 200) },
    });
    await sendCreditApplicationRejected({
      to: app.apContactEmail,
      contactName: app.apContactName,
      orgName: org?.name ?? app.legalName,
      reason: note,
    }).catch(() => {});
    return NextResponse.json({ ok: true, status: "REJECTED" });
  }

  return NextResponse.json(
    { error: "action must be 'approve' or 'reject'." },
    { status: 400 }
  );
}
