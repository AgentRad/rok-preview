// TEMPLATE: Rad must replace with attorney-reviewed copy before live launch.
// Boilerplate B2B-marketplace terms only. Not legal advice. Structural
// scaffolding so footer links resolve and the supplier onboarding flow has
// a real document to point at. The operative document is whatever is
// posted here at the time a buyer or supplier accepts.

import type { Metadata } from "next";
import { siteUrl } from "@/lib/site-url";
import LegalLayout, { type LegalSection } from "@/components/LegalLayout";

const TITLE = "Terms of Service";
const DESC =
  "The terms that govern access to and use of the PartsPort B2B marketplace by buyers, suppliers, and manufacturers.";
const URL = siteUrl("/legal/terms");

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
    heading: "1. Introduction",
    body: [
      "PartsPort, Inc. (referred to in this document as PartsPort, we, us, or our) operates an online business-to-business marketplace where vetted distributors list industrial equipment for sale to qualified buyers such as utilities, cooperatives, contractors, and EPCs. These Terms of Service govern your access to and use of the PartsPort site, applications, and APIs (together, the Service).",
      "By creating an account, placing an order, or otherwise using the Service, you accept these Terms on behalf of yourself and any entity you represent. If you do not accept these Terms, do not use the Service.",
    ],
  },
  {
    id: "definitions",
    heading: "2. Definitions",
    body: [
      "Buyer means a person or entity using the Service to source or order parts.",
      "Supplier means a distributor or manufacturer authorized by PartsPort to list parts for sale on the Service. Supplier-specific obligations are also set out in the Supplier Agreement.",
      "Listing means a product description, price, lead time, and other information posted by a Supplier on the Service.",
      "Order means a buyer-initiated purchase of one or more Listings through the Service.",
    ],
  },
  {
    id: "accounts",
    heading: "3. Accounts and eligibility",
    body: [
      "You must be at least 18 years old and authorized to bind your organization to contracts in order to register. You agree to provide accurate, current, and complete information at registration and to keep that information up to date.",
      "You are responsible for keeping your password, two-factor secret, and recovery codes confidential. Notify PartsPort promptly at security@partsport.agentgaming.gg if you suspect unauthorized access. You are responsible for all activity under your account until you do.",
    ],
  },
  {
    id: "marketplace",
    heading: "4. The marketplace",
    body: [
      "PartsPort is a marketplace operator. We do not manufacture the parts, and except where expressly stated we are not party to the sale. The contract for sale is formed between the Buyer and the Supplier at the moment PartsPort issues an order confirmation.",
      "PartsPort facilitates the transaction: identity-verifying Suppliers, hosting Listings, collecting payment, remitting funds to Suppliers, issuing invoices, coordinating freight, and providing support for disputes.",
    ],
  },
  {
    id: "orders",
    heading: "5. Orders, pricing, and payment",
    body: [
      "Listing prices are set by Suppliers and can change at any time before an order is placed. Once you submit an order and PartsPort confirms it, the price for that order is locked.",
      "Buyers pay PartsPort. PartsPort collects sales tax where required, charges a marketplace fee on top of the supplier price, and remits the supplier portion after dispatch. Payment is processed by our payment partner (currently Stripe). Cards, ACH, and wire transfers may be supported subject to underwriting.",
      "Quote-only Listings (typically over $3,000) follow the RFQ flow. An accepted quote becomes an Order on the same terms.",
    ],
  },
  {
    id: "shipping",
    heading: "6. Shipping and delivery",
    body: [
      "Lead times shown on a Listing are estimates from the Supplier. PartsPort coordinates freight and surfaces tracking information once the order is in transit.",
      "Risk of loss passes to the Buyer at the carrier handoff. Buyers must inspect shipments on arrival and note any visible damage on the carrier delivery receipt before signing.",
    ],
  },
  {
    id: "returns",
    heading: "7. Returns, refunds, and disputes",
    body: [
      "Returns, refunds, and warranty claims are handled through the Returns and Refund Policy posted at /legal/returns. Time-sensitive damage and shortage claims must be filed within the windows stated there.",
    ],
  },
  {
    id: "conduct",
    heading: "8. Acceptable use",
    body: [
      "Your use of the Service is also governed by our Acceptable Use Policy at /legal/acceptable-use. Among other restrictions, you must not attempt to disrupt the Service, reverse engineer it, or use it to sell counterfeit, stolen, or recalled goods.",
    ],
  },
  {
    id: "warranty",
    heading: "9. Warranties and disclaimers",
    body: [
      "PartsPort warrants that the Service will substantially perform as described. EXCEPT FOR THE LIMITED WARRANTIES STATED IN A SUPPLIER’S OWN PRODUCT WARRANTY OR EXPRESSLY IN WRITING BY PARTSPORT, THE SERVICE AND ALL LISTINGS ARE PROVIDED ON AN “AS IS” AND “AS AVAILABLE” BASIS, AND PARTSPORT DISCLAIMS ALL IMPLIED WARRANTIES INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT, TO THE FULLEST EXTENT PERMITTED BY LAW.",
    ],
  },
  {
    id: "liability",
    heading: "10. Limitation of liability",
    body: [
      "TO THE FULLEST EXTENT PERMITTED BY LAW, PARTSPORT WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUE, ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF THE SERVICE. PARTSPORT’S TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THESE TERMS WILL NOT EXCEED THE GREATER OF (a) THE AMOUNTS PAID OR PAYABLE BY YOU TO PARTSPORT IN THE TWELVE MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM AND (b) ONE THOUSAND U.S. DOLLARS.",
    ],
  },
  {
    id: "indemnity",
    heading: "11. Indemnification",
    body: [
      "You will defend, indemnify, and hold PartsPort and its affiliates harmless from and against any claims, damages, liabilities, and expenses (including reasonable attorneys’ fees) arising out of or related to your use of the Service in violation of these Terms, your Listings (if you are a Supplier), or your breach of any representation or warranty in these Terms.",
    ],
  },
  {
    id: "termination",
    heading: "12. Suspension and termination",
    body: [
      "PartsPort may suspend or terminate your access at any time, with or without notice, for any breach of these Terms or for conduct that we reasonably believe is harmful to the platform, other users, or third parties.",
      "You may close your account at any time from /settings. Closure does not erase historical records that PartsPort is required by law to retain.",
    ],
  },
  {
    id: "governing",
    heading: "13. Governing law and dispute resolution",
    body: [
      "These Terms are governed by the laws of the State of Delaware, without regard to its conflict-of-law principles. Any dispute that cannot be resolved informally will be brought exclusively in the state or federal courts located in New Castle County, Delaware, and you consent to the personal jurisdiction of those courts.",
    ],
  },
  {
    id: "changes",
    heading: "14. Changes to these Terms",
    body: [
      "We may update these Terms from time to time. The version posted at /legal/terms is the operative version. Material changes are announced by email to the address on file. Continued use of the Service after an update constitutes acceptance.",
    ],
  },
  {
    id: "contact",
    heading: "15. Contact",
    body: [
      "Questions about these Terms can be sent to legal@partsport.agentgaming.gg.",
    ],
  },
];

export default function TermsOfServicePage() {
  return (
    <LegalLayout
      currentHref="/legal/terms"
      title="Terms of Service"
      lede="The rules that govern your use of PartsPort as a buyer or as a visitor. Supplier-specific terms are in the Supplier Agreement."
      lastUpdated={LAST_UPDATED}
      sections={SECTIONS}
    />
  );
}
