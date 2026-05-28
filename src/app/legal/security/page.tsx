import type { Metadata } from "next";
import { siteUrl } from "@/lib/site-url";
import LegalLayout, { type LegalSection } from "@/components/LegalLayout";

const TITLE = "Security Posture";
const DESC =
  "One-page summary of PartsPort's security posture: encryption, authentication, infrastructure, vulnerability management, incident response, and compliance status.";
const URL = siteUrl("/legal/security");

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: URL },
  openGraph: {
    title: `${TITLE} | PartsPort`,
    description: DESC,
    type: "article",
    url: URL,
    siteName: "PartsPort",
    images: [{ url: "/og-default.svg", width: 1200, height: 630, alt: "PartsPort" }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${TITLE} | PartsPort`,
    description: DESC,
    images: ["/og-default.svg"],
  },
};

const LAST_UPDATED = "2026-05-27";

const SECTIONS: LegalSection[] = [
  {
    id: "encryption",
    heading: "1. Encryption",
    body: [
      "Data in transit is protected with TLS 1.3 between client browsers and PartsPort, and between PartsPort and its service providers. HTTP requests to the platform are redirected to HTTPS.",
      "Data at rest is encrypted with AES-256 by our managed database provider (Neon) and our blob storage provider (Vercel Blob). Database backups are encrypted by the provider.",
    ],
  },
  {
    id: "authentication",
    heading: "2. Authentication",
    body: [
      "User passwords are stored as bcrypt hashes with a per-user salt; PartsPort never stores plaintext passwords. A minimum password length of 8 characters is enforced.",
      "Optional TOTP-based two-factor authentication is available to every user. Account events that change credentials (password reset, password change, 2FA disable, email change confirmation, account self-delete) invalidate all existing sessions server-side by bumping a sessionsValidFrom timestamp checked on every request.",
      "Session tokens are signed JWTs issued by the platform with the signing secret rotated as a procedure; the platform refuses to start in production unless the secret is at least 32 characters long.",
    ],
  },
  {
    id: "authorization",
    heading: "3. Authorization",
    body: [
      "Access is role-based across BUYER, SUPPLIER, ADMIN, and MANUFACTURER roles, with per-supplier membership permissions (canManageDocuments, canSendMessages, canEditCatalog, and others). Administrative actions and supplier-side mutations are written to an append-only audit log that records actor, action, target, and metadata.",
      "Sensitive admin actions (supplier suspension, refund initiation, bank-info changes, document downloads) emit dedicated audit records reviewable at /admin/audit.",
    ],
  },
  {
    id: "infrastructure",
    heading: "4. Infrastructure",
    body: [
      "Application hosting: Vercel, primary region US-East. Database: Neon managed Postgres, US-East. Blob storage: Vercel Blob. Rate limiting: Upstash Redis. Error tracking: Sentry. Email: Resend. Payments: Stripe. Freight: Shippo. AI inference: Anthropic. DNS and edge: Cloudflare.",
      "All Customer Personal Data is processed in the United States. PartsPort does not currently transfer Customer Personal Data outside the United States in the ordinary course of operating the Service.",
    ],
  },
  {
    id: "vulnerability-management",
    heading: "5. Vulnerability management",
    body: [
      "Production errors and security-relevant exceptions are captured by Sentry and reviewed. Dependency updates and security advisories are tracked via GitHub Dependabot and reviewed against the application's dependency graph.",
      "Code changes flow through a single-branch review process with build gating; production deploys are blocked when the build is failing. Material changes to authentication, authorization, payments, or freight pricing receive a manual review pass focused on security.",
    ],
  },
  {
    id: "incident-response",
    heading: "6. Incident response",
    body: [
      "PartsPort maintains an incident response process targeting initial notification of affected customers within 24 hours of confirming a Personal Data Breach. Affected user accounts are isolated where appropriate (forced password reset, session invalidation, role suspension) while the incident is investigated and contained.",
      "Post-incident, PartsPort produces a short written summary covering scope, root cause, remediation, and follow-up actions, available to affected Customers on request.",
    ],
  },
  {
    id: "compliance",
    heading: "7. Compliance status",
    body: [
      "PartsPort is working toward SOC 2 Type II readiness. PartsPort does not hold a current SOC 2 attestation and does not hold an ISO 27001 certificate. PartsPort has not engaged a third-party auditor to attest to its controls at this time. PartsPort will publish any future attestation status on this page.",
      "PartsPort honors data subject rights under GDPR and CCPA as described in the Privacy Policy and Data Processing Addendum.",
    ],
  },
  {
    id: "retention",
    heading: "8. Data retention and deletion",
    body: [
      "Audit log entries are retained for 90 days for security investigations and trend analysis. Financial and transaction records (orders, invoices, payouts, tax records) are retained for seven years to satisfy IRS and equivalent record-keeping requirements.",
      "Account information is retained while the account is active. On account closure, identifying details are anonymized and the account is hard-deleted after a 30-day grace period.",
    ],
  },
  {
    id: "report",
    heading: "9. Reporting a vulnerability",
    body: [
      "Send vulnerability reports to security@partsport.agentgaming.gg. Include reproduction steps and an affected URL. PartsPort acknowledges reports within 5 business days and does not pursue legal action against good-faith security research conducted within the scope of this page.",
    ],
  },
];

export default function SecurityPage() {
  return (
    <LegalLayout
      currentHref="/legal/security"
      title="Security Posture"
      lede="A one-page summary of how PartsPort protects Customer data. For procurement questionnaires, see also the DPA and the subprocessor list."
      lastUpdated={LAST_UPDATED}
      sections={SECTIONS}
      templateWarning={false}
    />
  );
}
