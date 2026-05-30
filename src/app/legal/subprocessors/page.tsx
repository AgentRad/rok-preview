import type { Metadata } from "next";
import { siteUrl } from "@/lib/site-url";
import LegalLayout, { type LegalSection } from "@/components/LegalLayout";

const TITLE = "Subprocessors";
const DESC =
  "Current list of third-party Sub-processors that PartsPort uses to deliver the Service, with purpose, processing location, and links to each provider's own security and privacy documentation.";
const URL = siteUrl("/legal/subprocessors");

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

type Subprocessor = {
  name: string;
  purpose: string;
  location: string;
  link: string;
};

const SUBPROCESSORS: Subprocessor[] = [
  {
    name: "Vercel, Inc.",
    purpose: "Application hosting, edge delivery, analytics, and blob storage.",
    location: "United States",
    link: "https://vercel.com/legal/privacy-policy",
  },
  {
    name: "Neon, Inc.",
    purpose: "Managed Postgres database hosting for application data.",
    location: "United States",
    link: "https://neon.tech/privacy-policy",
  },
  {
    name: "Stripe, Inc.",
    purpose: "Payment processing, Stripe Connect payouts, and Stripe Tax computation.",
    location: "United States",
    link: "https://stripe.com/privacy",
  },
  {
    name: "Resend, Inc.",
    purpose: "Transactional outbound email and inbound email parsing for thread replies.",
    location: "United States",
    link: "https://resend.com/legal/privacy-policy",
  },
  {
    name: "Anthropic, PBC",
    purpose: "AI inference for catalog search, supplier assistant, and other AI features.",
    location: "United States",
    link: "https://www.anthropic.com/legal/privacy",
  },
  {
    name: "Upstash, Inc.",
    purpose: "Redis-based rate limiting and ephemeral counters.",
    location: "United States",
    link: "https://upstash.com/trust/privacy.pdf",
  },
  {
    name: "Shippo (Goshippo, Inc.)",
    purpose: "Freight rating, label generation, and tracking.",
    location: "United States",
    link: "https://goshippo.com/privacy",
  },
  {
    name: "Intuit Inc. (QuickBooks Online)",
    purpose: "Invoice and refund sync for suppliers and platform accounting (only when a Customer connects QuickBooks).",
    location: "United States",
    link: "https://www.intuit.com/privacy/statement/",
  },
  {
    name: "Cloudflare, Inc.",
    purpose: "Authoritative DNS, edge protection, and email routing for inbound parse domains.",
    location: "United States",
    link: "https://www.cloudflare.com/privacypolicy/",
  },
  {
    name: "Functional Software, Inc. (Sentry)",
    purpose: "Server-side error tracking and exception monitoring.",
    location: "United States",
    link: "https://sentry.io/privacy/",
  },
];

const SECTIONS: LegalSection[] = [
  {
    id: "intro",
    heading: "1. About this list",
    body: [
      "PartsPort engages the third-party Sub-processors listed below to help deliver the Service. Each provider acts on PartsPort's instructions under a written agreement that includes appropriate confidentiality and data protection obligations.",
      "This page is the authoritative list referenced by the PartsPort Data Processing Addendum. PartsPort will give at least 30 days' prior notice of any addition or replacement by updating this page (and, where Customer has opted in, by email to the designated DPA contact).",
    ],
  },
  ...SUBPROCESSORS.map<LegalSection>((s, i) => ({
    id: `sp-${i + 1}`,
    heading: `${i + 2}. ${s.name}`,
    body: [
      `Purpose: ${s.purpose}`,
      `Processing location: ${s.location}.`,
      `Provider documentation: ${s.link}`,
    ],
  })),
  {
    id: "contact",
    heading: `${SUBPROCESSORS.length + 2}. Questions and objections`,
    body: [
      "To object to a new Sub-processor on reasonable data protection grounds, or to request a copy of the standard sub-processing terms, email legal@partsport.agentgaming.gg within 30 days of the change being posted.",
    ],
  },
];

export default function SubprocessorsPage() {
  return (
    <LegalLayout
      currentHref="/legal/subprocessors"
      title="Subprocessors"
      lede="Third-party providers that Process Personal Data on PartsPort's behalf to deliver the Service."
      lastUpdated={LAST_UPDATED}
      sections={SECTIONS}
      templateWarning={false}
    />
  );
}
