import { NextResponse } from "next/server";
import { generateSpMetadata, resolveSsoConfigByOrgId } from "@/lib/sso";

export const runtime = "nodejs";

/**
 * PLH-3y-4: SP metadata XML. An IdP admin pastes this URL into their IdP to
 * configure PartsPort as a Service Provider in one step. Served even before
 * the org finishes configuring its IdP fields (the SP side does not depend on
 * the IdP cert).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const config = await resolveSsoConfigByOrgId(orgId);
  const xml = generateSpMetadata(orgId, config);
  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
