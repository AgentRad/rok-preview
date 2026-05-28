import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  readSsoConfigView,
  upsertSsoConfig,
  removeSsoConfig,
} from "@/lib/sso-config-admin";

export const runtime = "nodejs";

/**
 * PLH-3y-4: site-admin SSO config backend. Same operations as the org-admin
 * route but gated on platform Role=ADMIN and scoped to the orgId in the path.
 */
async function requireSiteAdmin(id: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
  }
  const org = await prisma.buyerOrg.findUnique({ where: { id }, select: { id: true } });
  if (!org) return { error: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  return { user, orgId: org.id };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const r = await requireSiteAdmin(id);
  if (r.error) return r.error;
  return NextResponse.json(await readSsoConfigView(r.orgId));
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const r = await requireSiteAdmin(id);
  if (r.error) return r.error;
  const body = await req.json().catch(() => ({}));
  try {
    await upsertSsoConfig(r.orgId, r.user, body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid SSO config." },
      { status: 400 }
    );
  }
  return NextResponse.json(await readSsoConfigView(r.orgId));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const r = await requireSiteAdmin(id);
  if (r.error) return r.error;
  await removeSsoConfig(r.orgId, r.user);
  return NextResponse.json({ ok: true });
}
