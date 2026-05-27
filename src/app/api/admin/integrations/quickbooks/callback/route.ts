import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  QBO_PROVIDER,
  exchangeCodeForTokens,
  intuitConfigured,
} from "@/lib/qbo-auth";
import { siteUrl } from "@/lib/site-url";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";

/**
 * PLH-3i P1: Intuit OAuth callback. Verifies the CSRF state cookie,
 * exchanges the authorization code for tokens, upserts the
 * IntegrationCredential row inside a transaction, and redirects the
 * admin back to the connect page with ?connected=1.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  if (!intuitConfigured()) {
    return NextResponse.json(
      {
        error:
          "Intuit OAuth not configured. Set INTUIT_CLIENT_ID and INTUIT_CLIENT_SECRET.",
      },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const realmId = url.searchParams.get("realmId");
  const error = url.searchParams.get("error");

  const jar = await cookies();
  const cookieState = jar.get("pp_qbo_state")?.value || "";

  // Always clear the state cookie once we read it.
  const clearCookie = (res: NextResponse) => {
    res.cookies.set("pp_qbo_state", "", { path: "/", maxAge: 0 });
    return res;
  };

  if (error) {
    return clearCookie(
      NextResponse.json(
        { error: `Intuit returned an error: ${error}` },
        { status: 400 }
      )
    );
  }
  if (!code || !state || !realmId) {
    return clearCookie(
      NextResponse.json(
        { error: "Missing code, state, or realmId." },
        { status: 400 }
      )
    );
  }
  if (!cookieState || cookieState !== state) {
    return clearCookie(
      NextResponse.json(
        { error: "State mismatch. Please try again." },
        { status: 400 }
      )
    );
  }

  try {
    const redirectUri = siteUrl("/api/admin/integrations/quickbooks/callback");
    const tokens = await exchangeCodeForTokens({ code, redirectUri });
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

    await prisma.$transaction(async (tx) => {
      await tx.integrationCredential.upsert({
        where: {
          provider_realmId: { provider: QBO_PROVIDER, realmId },
        },
        update: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt,
          connectedByUserId: user.id,
          connectedAt: new Date(),
          lastUsedAt: null,
        },
        create: {
          provider: QBO_PROVIDER,
          realmId,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt,
          connectedByUserId: user.id,
        },
      });
    });

    await writeAuditLog({
      actor: { id: user.id, email: user.email },
      action: "QBO_CONNECTED",
      targetType: "IntegrationCredential",
      targetId: realmId,
      summary: `Connected QuickBooks Online realm ${realmId}.`,
      metadata: { realmId, connectedByUserId: user.id },
    });

    return clearCookie(
      NextResponse.redirect(
        siteUrl("/admin/integrations/quickbooks?connected=1")
      )
    );
  } catch (err) {
    captureError(err, { subsystem: "qbo-auth", op: "callback" });
    return clearCookie(
      NextResponse.json(
        { error: "Failed to complete Intuit OAuth handshake." },
        { status: 500 }
      )
    );
  }
}
