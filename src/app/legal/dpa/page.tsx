// TEMPLATE: AI-drafted from industry-standard SaaS DPA examples.
// Pending attorney review before signature with any counterparty.

import type { Metadata } from "next";
import { siteUrl } from "@/lib/site-url";
import LegalLayout, { type LegalSection } from "@/components/LegalLayout";

const TITLE = "Data Processing Addendum";
const DESC =
  "PartsPort's Data Processing Addendum for buyers, suppliers, and manufacturers whose use of the Service involves the processing of personal data subject to GDPR or CCPA.";
const URL = siteUrl("/legal/dpa");

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
    id: "parties",
    heading: "1. Parties and scope",
    body: [
      "This Data Processing Addendum (DPA) forms part of the agreement between PartsPort, Inc. (PartsPort, the Processor) and the customer entity that has accepted PartsPort's Terms of Service or Supplier Agreement (Customer, the Controller). It governs the Processing of Personal Data by PartsPort on behalf of Customer in connection with Customer's use of the PartsPort Service.",
      "Where Customer is itself acting as a processor for an underlying controller, this DPA applies on a back-to-back basis and PartsPort acts as a sub-processor.",
    ],
  },
  {
    id: "definitions",
    heading: "2. Definitions",
    body: [
      "Capitalized terms not defined here have the meaning given in GDPR (Regulation (EU) 2016/679), the UK GDPR, the California Consumer Privacy Act as amended by the CPRA (collectively CCPA), or the underlying agreement.",
      "Personal Data means information relating to an identified or identifiable natural person submitted to the Service by or on behalf of Customer. Processing has the meaning given in Article 4(2) GDPR. Sub-processor means any third party engaged by PartsPort to Process Personal Data on Customer's behalf.",
    ],
  },
  {
    id: "scope-of-processing",
    heading: "3. Scope, nature, and purpose of Processing",
    body: [
      "Subject matter: provision of the PartsPort marketplace, including catalog browsing, order processing, RFQ handling, invoicing, payouts, freight booking, messaging, and customer support.",
      "Duration: for the term of the underlying agreement plus the retention periods set out in Section 9.",
      "Nature and purpose: to operate, secure, and support the Service in accordance with Customer's documented instructions, which include the underlying agreement and Customer's use of the Service in its normal configuration.",
      "Categories of Data Subjects: Customer personnel, end buyers, supplier personnel, manufacturer personnel, and freight recipients.",
      "Categories of Personal Data: identifiers (name, work email, phone), business contact details, shipping addresses, order history, RFQ content, freight tracking information, payment metadata (last4 and processor token references, not full PAN), IP address and device data, support correspondence, and authentication metadata.",
    ],
  },
  {
    id: "instructions",
    heading: "4. Roles and instructions",
    body: [
      "PartsPort acts as Processor (and, where applicable, Service Provider under CCPA) and Processes Personal Data only on documented instructions from Customer, including with regard to transfers, unless required to do otherwise by applicable law.",
      "PartsPort will notify Customer if, in its opinion, an instruction infringes applicable data protection law, unless prohibited from doing so on important grounds of public interest.",
      "PartsPort will not sell or share Personal Data (as those terms are defined under CCPA) and will not retain, use, or disclose Personal Data outside of the direct business relationship between Customer and PartsPort or for any purpose other than the specific business purpose of providing the Service.",
    ],
  },
  {
    id: "subprocessors",
    heading: "5. Sub-processors",
    body: [
      "Customer provides general authorization for PartsPort to engage Sub-processors to assist in providing the Service. The current list is maintained at /legal/subprocessors and is incorporated by reference.",
      "PartsPort will impose data protection obligations on each Sub-processor that are no less protective than those set out in this DPA. PartsPort remains responsible for the acts and omissions of its Sub-processors to the same extent as for its own acts and omissions under this DPA.",
      "PartsPort will give Customer at least 30 days' prior notice of any intended addition or replacement of a Sub-processor by updating the subprocessors page and, where Customer has opted in, by email to the designated DPA contact. Customer may object on reasonable data protection grounds within that notice period; if the objection cannot be resolved, Customer may terminate the affected portion of the Service.",
    ],
  },
  {
    id: "data-subject-rights",
    heading: "6. Data Subject Rights",
    body: [
      "Taking into account the nature of the Processing, PartsPort will assist Customer by appropriate technical and organizational measures, insofar as possible, in responding to requests from Data Subjects to exercise their rights under applicable law (access, rectification, erasure, restriction, portability, objection, and rights related to automated decision-making).",
      "If PartsPort receives a request from a Data Subject directly, it will, unless legally prohibited, route the request to Customer without itself responding to the substance and will not provide any information about Customer's records other than what is necessary to identify Customer as the controller.",
    ],
  },
  {
    id: "security",
    heading: "7. Security measures",
    body: [
      "PartsPort implements and maintains appropriate technical and organizational measures designed to protect Personal Data against accidental or unlawful destruction, loss, alteration, unauthorized disclosure, or access. A current summary is published at /legal/security and is incorporated by reference.",
      "These measures include encryption in transit and at rest, access controls based on least privilege, audit logging of administrative actions, hardened authentication (bcrypt password hashing, optional TOTP-based two-factor authentication, server-side session invalidation on credential change), rate limiting, vulnerability monitoring via Sentry and dependency scanning, and a documented incident response process.",
      "PartsPort reviews these measures periodically and may update them provided the level of security is not materially degraded.",
    ],
  },
  {
    id: "breach",
    heading: "8. Personal Data Breach notification",
    body: [
      "PartsPort will notify Customer without undue delay and in any event within 24 hours after becoming aware of a Personal Data Breach affecting Customer's Personal Data. The notification will include, to the extent then known, the nature of the breach, the categories and approximate number of Data Subjects and records concerned, the likely consequences, and the measures taken or proposed to address the breach and mitigate its effects.",
      "PartsPort will cooperate with Customer and take reasonable steps as directed by Customer to assist in the investigation, mitigation, and remediation of any Personal Data Breach.",
    ],
  },
  {
    id: "deletion",
    heading: "9. Return and deletion on termination",
    body: [
      "On termination or expiration of the underlying agreement, PartsPort will, at Customer's election, return or delete all Personal Data Processed on behalf of Customer. Customer may export its data via the Service prior to termination.",
      "PartsPort may retain Personal Data to the extent and for the period required by applicable law (including for tax, accounting, and fraud-prevention purposes, typically up to seven years for transaction records) or for the legitimate establishment, exercise, or defense of legal claims. Retained Personal Data remains subject to the confidentiality and security obligations of this DPA.",
    ],
  },
  {
    id: "audits",
    heading: "10. Audits",
    body: [
      "PartsPort will make available to Customer all information reasonably necessary to demonstrate compliance with this DPA. PartsPort will publish a current security posture summary at /legal/security and will respond, within a reasonable period, to Customer's reasonable written security questionnaires no more than once per twelve-month period.",
      "Where required by applicable law, Customer may, on at least 30 days' prior written notice and during PartsPort's normal business hours, conduct (itself or through an independent auditor bound by confidentiality) an audit of PartsPort's compliance with this DPA, no more than once per twelve-month period and subject to reasonable scoping. Customer bears the cost of any such audit unless it reveals material non-compliance.",
    ],
  },
  {
    id: "transfers",
    heading: "11. International data transfers",
    body: [
      "PartsPort Processes Personal Data primarily in the United States. Where Personal Data of Data Subjects in the European Economic Area, the United Kingdom, or Switzerland is transferred to PartsPort or any Sub-processor in a third country that has not received an adequacy decision, the parties agree that the Standard Contractual Clauses adopted by the European Commission in Decision 2021/914 (Module 2, controller-to-processor, or Module 3, processor-to-processor, as applicable), together with the UK International Data Transfer Addendum where the UK GDPR applies, are incorporated by reference and apply to such transfers.",
      "PartsPort will conduct and document transfer impact assessments where required and will implement supplementary measures as appropriate to ensure an essentially equivalent level of protection.",
    ],
  },
  {
    id: "ccpa",
    heading: "12. CCPA Service Provider terms",
    body: [
      "To the extent PartsPort Processes Personal Information of California residents on behalf of Customer, PartsPort acts as Customer's Service Provider as defined under the CCPA. PartsPort is prohibited from (a) selling or sharing the Personal Information, (b) retaining, using, or disclosing the Personal Information for any purpose other than the business purposes specified in this DPA and the underlying agreement, (c) retaining, using, or disclosing the Personal Information outside of the direct business relationship between the parties, and (d) combining the Personal Information with personal information received from or on behalf of any other person except as expressly permitted by the CCPA.",
      "PartsPort certifies that it understands the restrictions in this Section 12 and will comply with them.",
    ],
  },
  {
    id: "liability",
    heading: "13. Liability",
    body: [
      "Each party's liability under or in connection with this DPA is subject to the limitations and exclusions of liability set out in the underlying agreement.",
    ],
  },
  {
    id: "governing-law",
    heading: "14. Governing law and order of precedence",
    body: [
      "This DPA is governed by the law and subject to the jurisdiction provisions specified in the underlying agreement, except where mandatory provisions of applicable data protection law require otherwise.",
      "In the event of any conflict between this DPA and the underlying agreement with respect to the Processing of Personal Data, this DPA prevails. The Standard Contractual Clauses prevail over this DPA to the extent of any conflict.",
    ],
  },
  {
    id: "signature",
    heading: "15. Signature",
    body: [
      "Customer accepts this DPA by accepting the underlying agreement, by executing an order form that references this DPA, or by countersigning a copy provided by PartsPort. PartsPort accepts this DPA by publishing it at /legal/dpa and by providing the Service.",
      "Footnote: This DPA template was drafted by AI from industry-standard SaaS marketplace examples. Attorney review is pending before signature with any counterparty. Send DPA execution requests to legal@partsport.agentgaming.gg.",
    ],
  },
];

export default function DpaPage() {
  return (
    <LegalLayout
      currentHref="/legal/dpa"
      title="Data Processing Addendum"
      lede="The terms under which PartsPort Processes Personal Data on behalf of buyers, suppliers, and manufacturers."
      lastUpdated={LAST_UPDATED}
      sections={SECTIONS}
    />
  );
}
