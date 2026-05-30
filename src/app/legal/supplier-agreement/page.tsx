// TEMPLATE: Rad must replace with attorney-reviewed copy before live launch.
// This is the document THRADD (and every future distributor) signs to
// transact through PartsPort. The "Supplier Agreement" slot in the new
// SupplierDocument upload flow points here; suppliers download and sign
// this PDF, upload it, admin approves, and the onboarding checklist clears.

import type { Metadata } from "next";
import { siteUrl } from "@/lib/site-url";
import LegalLayout, { type LegalSection } from "@/components/LegalLayout";

const TITLE = "Supplier Agreement";
const DESC =
  "The terms distributors agree to when they sell on PartsPort. Fee, payout, reserve, listing, and fulfillment expectations.";
const URL = siteUrl("/legal/supplier-agreement");

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
    id: "parties",
    heading: "1. The parties",
    body: [
      "This Supplier Agreement (the Agreement) is between PartsPort, Inc., a Delaware corporation (PartsPort), and the distributor or other selling entity identified on the signature page (Supplier). It governs Supplier’s use of the PartsPort marketplace to list and sell industrial parts.",
      "By signing this Agreement (or by clicking accept where a click-through is offered), Supplier confirms that the signatory is authorized to bind Supplier and agrees to comply with the Terms of Service, the Acceptable Use Policy, the Privacy Policy, and the Returns and Refund Policy posted on PartsPort.",
    ],
  },
  {
    id: "qualifications",
    heading: "2. Supplier qualifications",
    body: [
      "PartsPort onboards Suppliers it believes can deliver reliably to commercial buyers in the United States. As a condition of listing, Supplier represents and warrants the following:",
    ],
    bullets: [
      "Supplier is a duly organized entity in good standing in its state of formation, with all licenses required to sell the categories of parts it lists.",
      "Supplier holds general liability and product liability insurance with minimum limits of $1,000,000 per occurrence and $2,000,000 aggregate, naming PartsPort as additionally insured. A current Certificate of Insurance is on file with PartsPort.",
      "Supplier has provided a current IRS Form W-9 (or W-8 series where applicable) and bank instructions for payouts.",
      "Supplier is authorized to sell the brands it lists and does not list counterfeit, stolen, recalled, gray-market, or otherwise unlawful goods.",
    ],
  },
  {
    id: "listings",
    heading: "3. Listings and pricing",
    body: [
      "Supplier sets the price and the stated lead time for each Listing. Listings must be accurate as to manufacturer, model, condition, specifications, and any compliance certifications, and must be updated promptly when those facts change.",
      "Where a Listing is over $3,000 or is a configured product, Supplier may flag it quote-only. The Supplier-set price on a quote-only Listing is indicative; the binding price is the one Supplier sends in response to an RFQ.",
    ],
  },
  {
    id: "fulfillment",
    heading: "4. Fulfillment",
    body: [
      "Supplier accepts orders routed through PartsPort by marking them Shipped with a carrier name and tracking number through the supplier dashboard or admin console. Shipments must include a packing slip referencing the PartsPort order reference. Supplier is responsible for proper packaging, freight class declaration, and any hazmat labeling required by carrier rules.",
      "Supplier must promptly update stock and lead time on the dashboard. Repeated short-shipping or chronic missed lead times are grounds for suspension.",
    ],
  },
  {
    id: "payment",
    heading: "5. Marketplace fee and payouts",
    body: [
      "PartsPort charges a marketplace fee on each successful order. The current fee rate is shown on the supplier dashboard and on each Listing’s preview. The fee is deducted from the Supplier price; Supplier is paid the supplier price minus the marketplace fee, minus any refunds processed on the order.",
      "Payouts are issued after the order is marked Shipped (subject to anti-fraud holds where reasonable) by ACH to the bank instructions on file. Payouts in process are visible on the supplier dashboard. PartsPort reports payouts on IRS Form 1099-K where required.",
    ],
  },
  {
    id: "returns",
    heading: "6. Returns and disputes",
    body: [
      "Returns are governed by the Returns and Refund Policy. Supplier agrees to honor that policy. Where a return is approved, PartsPort issues the refund to the buyer and reverses the supplier portion in the next payout. Supplier is responsible for return shipping and restocking unless the return is caused by buyer error and a restocking fee is stated on the Listing.",
      "Supplier acknowledges that PartsPort’s dispute decision is final for marketplace purposes. It does not waive either party’s legal rights outside of the marketplace.",
    ],
  },
  {
    id: "data",
    heading: "7. Data and confidentiality",
    body: [
      "Supplier may receive PartsPort confidential information, including pricing analytics, demand signals, and aggregated buyer behavior. Supplier will protect that information with at least the same care it uses for its own confidential information and will not use it for any purpose other than performing under this Agreement.",
      "Buyer personal data shared by PartsPort with Supplier (shipping address, contact information) is processed by Supplier as a separate controller for the purpose of fulfilling the order. Supplier complies with applicable privacy laws in that processing.",
    ],
  },
  {
    id: "ip",
    heading: "8. Intellectual property",
    body: [
      "Each party retains ownership of its own intellectual property. Supplier grants PartsPort a worldwide, non-exclusive, royalty-free license to display Supplier’s Listings, brand marks, and product images on the Service and in related marketing for the duration of this Agreement.",
    ],
  },
  {
    id: "indemnity",
    heading: "9. Indemnification",
    body: [
      "Supplier will defend, indemnify, and hold PartsPort and its affiliates harmless from and against any claims, damages, liabilities, and expenses arising out of (a) any Listing or product Supplier sells through the Service, (b) Supplier’s breach of its representations and warranties, (c) Supplier’s violation of applicable law, or (d) any infringement of a third party’s rights by Supplier’s content or products.",
    ],
  },
  {
    id: "term",
    heading: "10. Term and termination",
    body: [
      "This Agreement starts on the date of signature and continues until terminated. Either party may terminate for convenience on 30 days’ written notice. PartsPort may suspend or terminate immediately for breach of this Agreement, the Acceptable Use Policy, or applicable law, and may withhold payouts while investigating a credible report of misconduct.",
      "On termination, PartsPort will pay any earned-but-undisputed payouts within 30 days. Sections that by their nature should survive termination (data, confidentiality, indemnity, limitation of liability, governing law) survive.",
    ],
  },
  {
    id: "governing",
    heading: "11. Governing law",
    body: [
      "This Agreement is governed by the laws of the State of Delaware. Disputes that cannot be resolved informally will be brought exclusively in the state or federal courts located in New Castle County, Delaware.",
    ],
  },
  {
    id: "general",
    heading: "12. General",
    body: [
      "This Agreement, together with the documents it references, is the entire agreement between PartsPort and Supplier on the subjects it covers and supersedes any prior arrangement. Amendments require a written agreement signed by both parties (electronic signatures count). If any provision is unenforceable, the rest of the Agreement remains in force.",
    ],
  },
  {
    id: "contact",
    heading: "13. Contact",
    body: [
      "Supplier-relations and onboarding: suppliers@partsport.agentgaming.gg. Legal notices: legal@partsport.agentgaming.gg.",
    ],
  },
];

export default function SupplierAgreementPage() {
  return (
    <LegalLayout
      currentHref="/legal/supplier-agreement"
      title="Supplier Agreement"
      lede="The agreement every distributor signs to transact through PartsPort. Buyer-side terms are in the Terms of Service."
      lastUpdated={LAST_UPDATED}
      sections={SECTIONS}
    />
  );
}
