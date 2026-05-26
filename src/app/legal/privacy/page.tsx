// TEMPLATE: Rad must replace with attorney-reviewed copy before live launch.
// Boilerplate B2B-marketplace privacy notice. Not legal advice. Structured
// to disclose what PartsPort actually collects and processes today, so
// privacy regulators get a meaningful document even before counsel rewrites
// it.

import type { Metadata } from "next";
import { siteUrl } from "@/lib/site-url";
import LegalLayout, { type LegalSection } from "@/components/LegalLayout";

const TITLE = "Privacy Policy";
const DESC =
  "What PartsPort collects, how we use it, who we share it with, and the controls available to buyers, suppliers, and manufacturers.";
const URL = siteUrl("/legal/privacy");

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

const LAST_UPDATED = "2026-05-25";

const SECTIONS: LegalSection[] = [
  {
    id: "intro",
    heading: "1. Overview",
    body: [
      "This Privacy Policy describes how PartsPort, Inc. collects, uses, and shares information about you when you visit our website, create an account, place an order, or otherwise interact with our Service. It applies to buyers, suppliers, manufacturers, and visitors.",
    ],
  },
  {
    id: "collect",
    heading: "2. Information we collect",
    body: [
      "Account information you provide directly, such as your name, work email, company name, role, password (stored hashed), and optional two-factor secret.",
      "Order and transaction information generated when you use the Service, including products viewed and ordered, shipping addresses, invoices, freight tracking, returns, RFQs, and messages between buyers and suppliers.",
      "Payment information processed by our payment partner (currently Stripe). PartsPort does not store full card numbers or bank account numbers; we retain last4, brand, and a token reference.",
      "Technical information such as IP address, browser, device, referring URL, and high-level usage events captured for security monitoring and error tracking (currently via Sentry, when enabled).",
    ],
  },
  {
    id: "use",
    heading: "3. How we use information",
    body: [
      "To operate the Service: authenticate sessions, surface relevant listings, fulfill orders, route payouts, generate invoices, and coordinate freight.",
      "To prevent fraud and abuse: rate-limit endpoints, monitor for anomalies, verify supplier identity, and respond to security incidents.",
      "To communicate with you: send order, shipping, and RFQ notifications, password resets, security alerts, account changes, and infrequent product announcements.",
      "To improve the Service: aggregate usage statistics and search queries to refine the catalog and the AI search engine.",
    ],
  },
  {
    id: "share",
    heading: "4. How we share information",
    body: [
      "With Suppliers, when you place an order: enough information to fulfill the order (your name, shipping address, items, and quantities).",
      "With service providers: payment processing (Stripe), email delivery (Resend), database hosting (Neon), file storage (Vercel Blob), AI inference (Anthropic), error tracking (Sentry), rate limiting (Upstash), and cookieless first-party performance and traffic analytics (Vercel Analytics and Speed Insights). These providers act on our instructions under written contracts.",
      "When required by law, in response to a lawful request from a government authority, or to enforce these Terms or protect the rights, safety, or property of PartsPort or its users.",
      "PartsPort does not sell personal information. We do not share it for cross-context behavioral advertising.",
    ],
  },
  {
    id: "retention",
    heading: "5. Data retention",
    body: [
      "Account information is kept while your account is active. After account closure, identifying details are anonymized and the account is hard-deleted after a 30-day grace period during which you can recover it.",
      "Transaction records (orders, invoices, payouts) are retained for the period required by tax, accounting, and fraud-prevention obligations, typically seven years.",
    ],
  },
  {
    id: "rights",
    heading: "6. Your rights",
    body: [
      "Depending on where you live, you may have the right to access, correct, port, or delete personal information we hold about you, and to object to certain processing. To exercise these rights, email privacy@partsport.agentgaming.gg from the address on your account. We may need to verify your identity before acting on a request.",
      "California residents have specific rights under the CCPA / CPRA, including the right to know, the right to delete, the right to correct, and the right not to be retaliated against for exercising these rights.",
    ],
  },
  {
    id: "security",
    heading: "7. Security",
    body: [
      "We protect your information with industry-standard measures: TLS in transit, bcrypt-hashed passwords, JWT session tokens, rate limiting on authentication endpoints, optional TOTP-based two-factor authentication, and access controls on internal admin tooling. No method of transmission or storage is perfectly secure; report any suspected vulnerability to security@partsport.agentgaming.gg.",
    ],
  },
  {
    id: "cookies",
    heading: "8. Cookies and similar technologies",
    body: [
      "PartsPort uses a small number of cookies: a session cookie (sets when you sign in), a CSRF token, a cart cookie for guest checkout, and a consent cookie (pp_consent) that records whether you have dismissed the consent banner. We do not use third-party advertising or analytics cookies.",
    ],
  },
  {
    id: "children",
    heading: "9. Children",
    body: [
      "PartsPort is a B2B service intended for industrial buyers and is not directed to children under 16. We do not knowingly collect personal information from children under 16. If you believe we have, email privacy@partsport.agentgaming.gg and we will delete it.",
    ],
  },
  {
    id: "international",
    heading: "10. International transfers",
    body: [
      "PartsPort is operated from the United States. If you access the Service from outside the United States, your information may be processed in the U.S. and other jurisdictions whose data protection laws may differ from yours. By using the Service, you consent to that processing.",
    ],
  },
  {
    id: "changes",
    heading: "11. Changes to this Policy",
    body: [
      "We may update this Policy from time to time. Material changes will be announced by email to the address on file. The version posted at /legal/privacy is the operative version.",
    ],
  },
  {
    id: "contact",
    heading: "12. Contact",
    body: [
      "Questions about this Policy or requests to exercise your privacy rights can be sent to privacy@partsport.agentgaming.gg.",
    ],
  },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalLayout
      currentHref="/legal/privacy"
      title="Privacy Policy"
      lede="What we collect, why we collect it, who we share it with, and how to exercise your rights."
      lastUpdated={LAST_UPDATED}
      sections={SECTIONS}
    />
  );
}
