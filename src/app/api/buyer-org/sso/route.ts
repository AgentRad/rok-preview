import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import {
  getActiveBuyerOrgContext,
  canManageBuyerOrg,
} from "@/lib/buyer-org-access";
import {
  readSsoConfigView,
  upsertSsoConfig,
  removeSsoConfig,
} from "@/lib/sso-config-admin";

export const runtime = "nodejs";

/**
 * PLH-3y-4: org-admin SSO config backend, scoped to the caller's active org.
 * A site admin uses the parallel /api/admin/buyer-orgs/[id]/sso route.
 */
async function requireOrgAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Please sign in." }, { status: 401 }) };
  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx || !canManageBuyerOrg(ctx.role)) {
    return {
      error: NextResponse.json(
        { error: "Only an organization admin can manage SSO." },
        { status: 403 }
      ),
    };
  }
  return { user, orgId: ctx.org.id };
}

export async function GET() {
  const r = await requireOrgAdmin();
  if (r.error) return r.error;
  return NextResponse.json(await readSsoConfigView(r.orgId));
}

export async function PUT(req: Request) {
  const r = await requireOrgAdmin();
  if (r.error) return r.error;
  const rl = await rateLimit("generic", `user:${r.user.id}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
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

export async function DELETE() {
  const r = await requireOrgAdmin();
  if (r.error) return r.error;
  await removeSsoConfig(r.orgId, r.user);
  return NextResponse.json({ ok: true });
}
