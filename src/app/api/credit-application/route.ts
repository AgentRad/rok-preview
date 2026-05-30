import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { generateReference } from "@/lib/order-utils";
import {
  getActiveBuyerOrgContext,
  canManageBuyerOrg,
} from "@/lib/buyer-org-access";
import type { PaymentTerms } from "@prisma/client";

export const runtime = "nodejs";

const VALID_TERMS: PaymentTerms[] = ["NET_15", "NET_30", "NET_60"];

type RefRow = {
  companyName: string;
  contact: string;
  phone: string;
  email: string;
};

/**
 * PLH-3z-3: an org ADMIN requests net-terms billing for their active org.
 * Creating an application leaves it PENDING for site-admin review at
 * /admin/credit-applications. Credit limit is admin-set on approval; this form
 * captures the requested limit + terms + company details + trade references.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx || !canManageBuyerOrg(ctx.role)) {
    return NextResponse.json(
      { error: "Only an organization admin can request net terms." },
      { status: 403 }
    );
  }
  const rl = await rateLimit("generic", `user:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  // One open application per org at a time.
  const existing = await prisma.creditApplication.findFirst({
    where: { orgId: ctx.org.id, status: "PENDING" },
  });
  if (existing) {
    return NextResponse.json(
      { error: "An application is already under review for this organization." },
      { status: 409 }
    );
  }

  const body = await req.json().catch(() => ({}));

  const legalName = String(body.legalName || "").trim();
  const ein = String(body.ein || "").trim();
  const billingAddress = String(body.billingAddress || "").trim();
  const apContactName = String(body.apContactName || "").trim();
  const apContactEmail = String(body.apContactEmail || "").trim();
  if (!legalName || !ein || !billingAddress || !apContactName || !apContactEmail) {
    return NextResponse.json(
      {
        error:
          "Company legal name, EIN, billing address, and AP contact name + email are required.",
      },
      { status: 400 }
    );
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(apContactEmail)) {
    return NextResponse.json(
      { error: "AP contact email is not valid." },
      { status: 400 }
    );
  }

  const requestedTerms = String(body.requestedTerms || "").toUpperCase() as PaymentTerms;
  if (!VALID_TERMS.includes(requestedTerms)) {
    return NextResponse.json(
      { error: "Requested terms must be NET_15, NET_30, or NET_60." },
      { status: 400 }
    );
  }

  const expectedMonthly = Number(body.expectedMonthlyDollars);
  if (!Number.isFinite(expectedMonthly) || expectedMonthly < 0) {
    return NextResponse.json(
      { error: "Expected monthly spend must be a non-negative number." },
      { status: 400 }
    );
  }
  const requestedLimit = Number(body.requestedLimitDollars);
  if (!Number.isFinite(requestedLimit) || requestedLimit <= 0) {
    return NextResponse.json(
      { error: "Requested credit limit must be a positive number." },
      { status: 400 }
    );
  }

  let yearsInBusiness: number | null = null;
  if (body.yearsInBusiness !== undefined && body.yearsInBusiness !== null && String(body.yearsInBusiness).trim() !== "") {
    const y = Number(body.yearsInBusiness);
    if (!Number.isFinite(y) || y < 0 || y > 500) {
      return NextResponse.json(
        { error: "Years in business must be between 0 and 500." },
        { status: 400 }
      );
    }
    yearsInBusiness = Math.round(y);
  }

  const w9BlobUrl = body.w9BlobUrl ? String(body.w9BlobUrl).trim() : null;
  if (w9BlobUrl && !/^https:\/\//i.test(w9BlobUrl)) {
    return NextResponse.json(
      { error: "W-9 URL must start with https://." },
      { status: 400 }
    );
  }

  const references: RefRow[] = Array.isArray(body.references)
    ? body.references
        .map((r: unknown) => {
          const o = (r ?? {}) as Record<string, unknown>;
          return {
            companyName: String(o.companyName || "").trim().slice(0, 200),
            contact: String(o.contact || "").trim().slice(0, 200),
            phone: String(o.phone || "").trim().slice(0, 60),
            email: String(o.email || "").trim().slice(0, 200),
          };
        })
        .filter((r: RefRow) => r.companyName.length > 0)
        .slice(0, 10)
    : [];

  const created = await prisma.creditApplication.create({
    data: {
      reference: generateReference("CA"),
      orgId: ctx.org.id,
      submittedByUserId: user.id,
      legalName: legalName.slice(0, 300),
      dba: body.dba ? String(body.dba).trim().slice(0, 300) : null,
      ein: ein.slice(0, 40),
      yearsInBusiness,
      expectedMonthlyCents: Math.round(expectedMonthly * 100),
      requestedLimitCents: Math.round(requestedLimit * 100),
      requestedTerms,
      billingAddress: billingAddress.slice(0, 1000),
      apContactName: apContactName.slice(0, 200),
      apContactEmail: apContactEmail.slice(0, 200),
      apContactPhone: body.apContactPhone ? String(body.apContactPhone).trim().slice(0, 60) : null,
      references,
      w9BlobUrl,
      dunsNumber: body.dunsNumber ? String(body.dunsNumber).trim().slice(0, 40) : null,
      notes: body.notes ? String(body.notes).trim().slice(0, 2000) : "",
    },
  });

  await writeAuditLog({
    actor: user,
    action: "CREDIT_APP_SUBMITTED",
    targetType: "CreditApplication",
    targetId: created.id,
    summary: `Credit application ${created.reference} submitted for ${ctx.org.name} (requested ${requestedTerms}, $${requestedLimit.toFixed(2)} limit)`,
    metadata: {
      orgId: ctx.org.id,
      requestedTerms,
      requestedLimitCents: created.requestedLimitCents,
    },
  });

  return NextResponse.json({ ok: true, reference: created.reference });
}
