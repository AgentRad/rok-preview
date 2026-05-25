// TEMPLATE — Rad must replace with attorney-reviewed copy before live launch.

import type { Metadata } from "next";
import LegalLayout, { type LegalSection } from "@/components/LegalLayout";

export const metadata: Metadata = {
  title: "Returns and Refunds · PartsPort",
};

const LAST_UPDATED = "2026-05-25";

const SECTIONS: LegalSection[] = [
  {
    id: "intro",
    heading: "1. Overview",
    body: [
      "This policy describes how PartsPort handles returns, refunds, and damage or shortage claims for orders placed on the marketplace. It is incorporated into the Terms of Service.",
    ],
  },
  {
    id: "window",
    heading: "2. Time windows",
    body: [
      "Different claim types have different windows because freight, payment, and warranty mechanics differ.",
    ],
    bullets: [
      "Visible freight damage or shortage: note it on the carrier delivery receipt before signing, and file a claim through the order page within 48 hours of delivery. Photographs of the damage and the carrier receipt are required.",
      "Concealed damage: report it through the order page within 7 days of delivery, with photographs.",
      "Wrong item or material defect (return for refund or replacement): open a return request from the order page within 30 days of delivery. Items must be in original packaging and unused unless a defect is the reason for return.",
      "Buyer-initiated cancellation: allowed from the order page until the supplier marks the order as Shipped. Once the order ships, returns are governed by the rules above.",
    ],
  },
  {
    id: "process",
    heading: "3. How returns work",
    body: [
      "Open a return from the order page. PartsPort reviews the request, coordinates with the supplier, and either approves, requests more information, or rejects the request. Approved returns include return-shipping instructions and a return-merchandise authorization (RMA) reference.",
      "Once the supplier receives and inspects the returned item, PartsPort issues the refund through the original payment method. ACH and wire refunds take 5–10 business days; card refunds typically post within 5 business days but depend on the issuing bank.",
    ],
  },
  {
    id: "non-returnable",
    heading: "4. Non-returnable items",
    body: [
      "Some Listings are non-returnable by their nature. The supplier identifies these at listing time and they are flagged on the product page before purchase.",
    ],
    bullets: [
      "Custom-built, configured-to-order, or special-order equipment.",
      "Hazardous materials and items that require disposal under environmental rules.",
      "Items damaged by improper installation or storage after delivery.",
    ],
  },
  {
    id: "refund-amount",
    heading: "5. Refund amount",
    body: [
      "An approved refund returns the supplier price, sales tax, and freight to the buyer. The marketplace fee is refunded unless the return was caused by buyer error (wrong item ordered, change of mind on a custom item). A restocking fee may apply when stated on the original Listing.",
    ],
  },
  {
    id: "warranty",
    heading: "6. Manufacturer warranty",
    body: [
      "Where a Listing comes with a manufacturer warranty, the manufacturer is the warrantor and the buyer interacts with the manufacturer directly for warranty service. PartsPort’s role on warranty claims is to provide proof of purchase and serial number records.",
    ],
  },
  {
    id: "disputes",
    heading: "7. Disputes",
    body: [
      "If a buyer and supplier cannot resolve a return through the on-platform flow, either party may escalate to PartsPort by emailing support@partsport.agentgaming.gg with the order reference. PartsPort will review the available evidence and decide. The decision is final for marketplace purposes; it does not waive either party’s legal rights.",
    ],
  },
  {
    id: "contact",
    heading: "8. Contact",
    body: [
      "Returns questions: returns@partsport.agentgaming.gg. Disputes: support@partsport.agentgaming.gg.",
    ],
  },
];

export default function ReturnsPolicyPage() {
  return (
    <LegalLayout
      currentHref="/legal/returns"
      title="Returns and Refund Policy"
      lede="How damage, shortage, and return claims work on PartsPort, including timelines and refund amounts."
      lastUpdated={LAST_UPDATED}
      sections={SECTIONS}
    />
  );
}
