import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runSsoAction } from "@/lib/sso-actions";

export const runtime = "nodejs";

/**
 * PLH-3y-5: site-admin SSO actions (SCIM token + cert rotation), gated on
 * platform Role=ADMIN and scoped to the orgId in the path.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const org = await prisma.buyerOrg.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!org) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  return runSsoAction(org.id, user, body);
}
