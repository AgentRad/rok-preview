// TEMPLATE: Rad must replace with attorney-reviewed copy before live launch.

import type { Metadata } from "next";
import { siteUrl } from "@/lib/site-url";
import LegalLayout, { type LegalSection } from "@/components/LegalLayout";

const TITLE = "Acceptable Use Policy";
const DESC =
  "Conduct rules for everyone using PartsPort. What we won't tolerate, and what happens when an account crosses the line.";
const URL = siteUrl("/legal/acceptable-use");

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
    heading: "1. Purpose",
    body: [
      "This Acceptable Use Policy describes conduct that is not allowed on PartsPort. It applies to all users (buyers, suppliers, manufacturers, and visitors) and is incorporated into the Terms of Service.",
    ],
  },
  {
    id: "platform",
    heading: "2. Platform abuse",
    body: [
      "You may not interfere with or attempt to interfere with the operation of the Service.",
    ],
    bullets: [
      "Do not probe, scan, or test the vulnerability of the Service without prior written authorization. Coordinate disclosure with security@partsport.agentgaming.gg.",
      "Do not deploy bots, scrapers, or automated agents that disrupt the Service or violate published rate limits.",
      "Do not reverse engineer, decompile, or otherwise attempt to derive the source code of the Service, except as expressly permitted by law.",
      "Do not impersonate another person or entity, or create accounts for the purpose of misleading other users.",
    ],
  },
  {
    id: "listings",
    heading: "3. Listings (Suppliers)",
    body: [
      "Suppliers are responsible for the accuracy and legality of their Listings.",
    ],
    bullets: [
      "Do not list counterfeit, stolen, recalled, or otherwise unlawful goods.",
      "Do not list goods you are not legally authorized to sell in the buyer’s jurisdiction.",
      "Do not misrepresent manufacturer, model, condition, capacity, or compliance certifications.",
      "Do not list parts subject to export controls or sanctions in a way that would violate U.S. or applicable foreign law.",
    ],
  },
  {
    id: "content",
    heading: "4. Content and messaging",
    body: [
      "Messages, RFQs, reviews, and other user-generated content must comply with these rules.",
    ],
    bullets: [
      "No harassing, threatening, hateful, or discriminatory content. No content that sexualizes minors.",
      "No spam, phishing, or solicitations off-platform that route around the marketplace fee.",
      "No content that infringes another person’s intellectual property, privacy, or publicity rights.",
      "Reviews must be honest, based on your own experience, and not coordinated to manipulate a supplier’s rating.",
    ],
  },
  {
    id: "payments",
    heading: "5. Payments and chargebacks",
    body: [
      "Payment fraud is grounds for immediate suspension.",
    ],
    bullets: [
      "Do not use a payment method you are not authorized to use.",
      "Do not initiate a chargeback for an order you received and accepted. Use the returns and dispute flow at /legal/returns first.",
      "Do not direct or accept off-platform payment for an order that was sourced through PartsPort.",
    ],
  },
  {
    id: "enforcement",
    heading: "6. Enforcement",
    body: [
      "PartsPort may suspend or terminate accounts, remove Listings, refund or reverse transactions, and report unlawful conduct to law enforcement. We give notice when practical, but we may act immediately when needed to protect the platform, our users, or third parties.",
    ],
  },
  {
    id: "report",
    heading: "7. Reporting abuse",
    body: [
      "If you see content or behavior that violates this policy, email abuse@partsport.agentgaming.gg with as much detail as you can: the supplier or buyer involved, the order or listing reference, what happened, and any screenshots.",
    ],
  },
];

export default function AcceptableUsePage() {
  return (
    <LegalLayout
      currentHref="/legal/acceptable-use"
      title="Acceptable Use Policy"
      lede="Conduct that is not allowed on PartsPort. Violations can suspend or terminate your account."
      lastUpdated={LAST_UPDATED}
      sections={SECTIONS}
    />
  );
}
