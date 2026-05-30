import { NextResponse } from "next/server";
import {
  buildSaml,
  classifySamlError,
  provisionSsoUser,
  recordSsoEvent,
  resolveSsoConfigByOrgId,
  ssoSessionMaxAgeSec,
} from "@/lib/sso";
import { emailDomain } from "@/lib/free-email-domains";
import { createSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { siteUrl } from "@/lib/site-url";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

function fail(reason: string) {
  return NextResponse.redirect(siteUrl(`/login?sso_error=${reason}`), {
    status: 303,
  });
}

/**
 * PLH-3y-4: Assertion Consumer Service. The IdP POSTs a signed SAMLResponse
 * here. @node-saml/node-saml verifies the XML signature and validates the
 * assertion conditions (NotBefore / NotOnOrAfter / audience) before we trust
 * anything. On success we JIT-provision the user and open an SSO session whose
 * lifetime respects the org's sessionMaxAgeMin policy. Every outcome is
 * recorded in SsoLoginEvent.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;

  const limit = await rateLimit("login", clientIp(req));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429 }
    );
  }

  const config = await resolveSsoConfigByOrgId(orgId);
  if (!config) return fail("unavailable");

  const form = await req.formData().catch(() => null);
  const samlResponse = form?.get("SAMLResponse");
  if (typeof samlResponse !== "string" || !samlResponse) {
    return fail("badrequest");
  }

  // Signature + condition validation is fully delegated to node-saml. Any
  // rejection lands in catch and is classified for the audit trail; we never
  // proceed to provisioning on a failed assertion.
  let profile: Record<string, unknown> | null;
  try {
    const saml = buildSaml(config, { requireCert: true });
    const result = await saml.validatePostResponseAsync({
      SAMLResponse: samlResponse,
    });
    profile = result.profile as Record<string, unknown> | null;
  } catch (err) {
    const outcome = classifySamlError(err);
    await recordSsoEvent({
      buyerOrgId: orgId,
      email: "unknown",
      outcome,
      req,
    });
    return fail(outcome.toLowerCase());
  }

  if (!profile) return fail("badrequest");

  const attributes =
    (profile.attributes as Record<string, unknown> | undefined) ?? {};
  const nameId = typeof profile.nameID === "string" ? profile.nameID : "";
  const attrEmail =
    (typeof attributes.email === "string" && attributes.email) ||
    (typeof attributes[
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
    ] === "string" &&
      (attributes[
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
      ] as string)) ||
    "";
  const email = (nameId.includes("@") ? nameId : attrEmail).toLowerCase().trim();

  if (!email || !emailDomain(email)) {
    await recordSsoEvent({
      buyerOrgId: orgId,
      email: email || "unknown",
      outcome: "FAILED_DOMAIN",
      req,
    });
    return fail("failed_domain");
  }

  // Domain allowlist gate. An empty allowlist accepts any domain; a non-empty
  // one must contain the asserted email's domain or we refuse to provision.
  const domain = emailDomain(email)!;
  const allow = config.domainAllowlist.map((d) => d.toLowerCase());
  if (allow.length > 0 && !allow.includes(domain)) {
    await recordSsoEvent({
      buyerOrgId: orgId,
      email,
      outcome: "FAILED_DOMAIN",
      req,
    });
    return fail("failed_domain");
  }

  const { userId, role, provisioned } = await provisionSsoUser({
    config,
    email,
    attributes,
  });

  await recordSsoEvent({
    buyerOrgId: orgId,
    userId,
    email,
    outcome: "SUCCESS",
    req,
  });
  await writeAuditLog({
    actor: { id: userId, email },
    action: "SSO_LOGIN_SUCCESS",
    targetType: "BuyerOrg",
    targetId: orgId,
    summary: `SSO login success for ${email} as ${role}${
      provisioned ? " (JIT-provisioned)" : ""
    }.`,
    metadata: { role, provisioned },
  });

  // Session lifetime respects the org policy. When honorIdpSessionExpiry is on
  // and the assertion carries a SessionNotOnOrAfter, cap to whichever is
  // sooner (SAML has no introspection, so this is the only IdP-driven signal).
  let maxAgeSec = ssoSessionMaxAgeSec(config);
  if (config.honorIdpSessionExpiry) {
    const raw = profile.sessionNotOnOrAfter;
    if (typeof raw === "string") {
      const until = Math.floor((new Date(raw).getTime() - Date.now()) / 1000);
      if (Number.isFinite(until) && until > 60) {
        maxAgeSec = Math.min(maxAgeSec, until);
      }
    }
  }

  await createSession(userId, { sso: true, org: orgId, maxAgeSec });
  return NextResponse.redirect(siteUrl("/buyer-org"), { status: 303 });
}
