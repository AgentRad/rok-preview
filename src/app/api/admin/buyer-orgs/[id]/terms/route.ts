import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import type { PaymentTerms } from "@prisma/client";

export const runtime = "nodejs";

const VALID_TERMS: PaymentTerms[] = ["PREPAID", "NET_15", "NET_30", "NET_60"];

/**
 * PLH-3z-1: site admin sets an org's payment terms + manual credit limit.
 * Flipping an org off PREPAID enables net-terms invoice orders for its
 * members. creditLimitCents is a manual ceiling this round (no D-U-N-S /
 * auto-approve).
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const terms = String(body.paymentTerms || "").toUpperCase() as PaymentTerms;
  if (!VALID_TERMS.includes(terms)) {
    return NextResponse.json(
      { error: "paymentTerms must be PREPAID, NET_15, NET_30, or NET_60." },
      { status: 400 }
    );
  }

  // creditLimitCents: optional. Accept a dollar amount or null/blank to clear.
  let creditLimitCents: number | null = null;
  if (body.creditLimitDollars !== undefined && body.creditLimitDollars !== null && String(body.creditLimitDollars).trim() !== "") {
    const dollars = Number(body.creditLimitDollars);
    if (!Number.isFinite(dollars) || dollars < 0) {
      return NextResponse.json(
        { error: "creditLimitDollars must be a non-negative number." },
        { status: 400 }
      );
    }
    creditLimitCents = Math.round(dollars * 100);
  }

  const org = await prisma.buyerOrg.findUnique({ where: { id } });
  if (!org) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }

  await prisma.buyerOrg.update({
    where: { id },
    data: { paymentTerms: terms, creditLimitCents },
  });
  await writeAuditLog({
    actor: user,
    action: "BUYER_ORG_TERMS_UPDATED",
    targetType: "BuyerOrg",
    targetId: id,
    summary: `Org ${org.name} terms set to ${terms}${creditLimitCents !== null ? ` (credit limit $${(creditLimitCents / 100).toFixed(2)})` : ""}`,
    metadata: { paymentTerms: terms, creditLimitCents },
  });
  return NextResponse.json({ ok: true, paymentTerms: terms, creditLimitCents });
}
