import "server-only";
import { NextResponse } from "next/server";
import type { User } from "@prisma/client";
import {
  rotateScimToken,
  disableScim,
  stageNextCert,
  activateNextCert,
  readSsoConfigView,
} from "./sso-config-admin";

/**
 * PLH-3y-5: shared SSO action dispatcher used by both the org-admin and the
 * site-admin actions routes. Auth + org resolution happen in the route; this
 * just runs the requested management action and returns a JSON response.
 */
export async function runSsoAction(
  orgId: string,
  actor: Pick<User, "id" | "email">,
  body: Record<string, unknown>
): Promise<Response> {
  const action = String(body.action ?? "");
  try {
    switch (action) {
      case "scim-rotate": {
        const { token, last4 } = await rotateScimToken(orgId, actor);
        // Token shown exactly once; never returned again.
        return NextResponse.json({ ok: true, token, last4 });
      }
      case "scim-disable":
        await disableScim(orgId, actor);
        return NextResponse.json({ ok: true });
      case "cert-stage":
        await stageNextCert(orgId, actor, String(body.certNext ?? ""));
        return NextResponse.json({ ok: true, view: await readSsoConfigView(orgId) });
      case "cert-activate":
        await activateNextCert(orgId, actor);
        return NextResponse.json({ ok: true, view: await readSsoConfigView(orgId) });
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Action failed." },
      { status: 400 }
    );
  }
}
