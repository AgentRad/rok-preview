import { authenticateScim, scimError, scimJson } from "@/lib/scim";
import { siteUrl } from "@/lib/site-url";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * PLH-3y-5: SCIM 2.0 discovery document. Advertises the features PartsPort
 * supports: PATCH yes, bulk no, filter yes, no password change, bearer auth.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const rl = await rateLimit("scim", `org:${orgId}`);
  if (!rl.allowed) return scimError(429, "Too many requests.");
  const config = await authenticateScim(orgId, req);
  if (!config) return scimError(401, "Unauthorized.");

  return scimJson({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    documentationUri: siteUrl("/legal/security"),
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "OAuth Bearer Token",
        description: "Authentication via the SCIM bearer token issued in PartsPort.",
        primary: true,
      },
    ],
    meta: {
      resourceType: "ServiceProviderConfig",
      location: siteUrl(`/api/scim/v2/${orgId}/ServiceProviderConfig`),
    },
  });
}
