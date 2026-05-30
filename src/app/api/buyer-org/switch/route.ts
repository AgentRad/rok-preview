import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * PLH-3y-1: set the caller's active buyer org. Only orgs the user is a member
 * of are accepted. activeBuyerOrgId is read by getActiveBuyerOrgContext and
 * is plumbed through for later rounds to scope orders + shared resources.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const orgId = String(body.orgId || "");
  if (!orgId) {
    return NextResponse.json({ error: "orgId is required." }, { status: 400 });
  }

  const membership = await prisma.buyerOrgMember.findUnique({
    where: { buyerOrgId_userId: { buyerOrgId: orgId, userId: user.id } },
  });
  if (!membership) {
    return NextResponse.json(
      { error: "You are not a member of that organization." },
      { status: 403 }
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { activeBuyerOrgId: orgId },
  });

  return NextResponse.json({ ok: true });
}
