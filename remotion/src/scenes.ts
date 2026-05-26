// Scene data for all 4 PartsPort videos.
// Durations are in seconds; we convert to frames at 30fps in the Root.

export type Scene =
  | {
      kind: "hook";
      headline: string;
      durationSec: number;
    }
  | {
      kind: "demo";
      eyebrow: string;
      headline: string;
      image: string;
      durationSec: number;
    }
  | {
      kind: "cta";
      eyebrow: string;
      headline: string;
      url: string;
      durationSec: number;
    };

const SHOT_BASE = "/pitch";

export type VideoSpec = {
  id: string;
  brandSubtitle: string;
  scenes: Scene[];
};

export const VIDEOS: Record<string, VideoSpec> = {
  WhatIsPartsPort: {
    id: "WhatIsPartsPort",
    brandSubtitle: "what is partsport",
    scenes: [
      { kind: "hook", headline: "Utilities spend weeks emailing distributors to find one part.", durationSec: 3 },
      { kind: "hook", headline: "We built the marketplace.", durationSec: 2.6 },
      { kind: "demo", eyebrow: "One search", headline: "Type the part. Get vetted suppliers.", image: `${SHOT_BASE}/01-home.png`, durationSec: 4 },
      { kind: "demo", eyebrow: "Real stock · Real pricing", headline: "Filter by lead time, manufacturer, region.", image: `${SHOT_BASE}/02-catalog.png`, durationSec: 4 },
      { kind: "demo", eyebrow: "Product pages", headline: "Spec sheets. Datasheets. No mystery vendors.", image: `${SHOT_BASE}/06-product-detail.png`, durationSec: 4 },
      { kind: "demo", eyebrow: "Two ways to buy", headline: "Instant checkout. Or RFQ for big-ticket gear.", image: `${SHOT_BASE}/04-how-it-works.png`, durationSec: 4 },
      { kind: "demo", eyebrow: "Three sides", headline: "Buyers free. Distributors 6 percent. OEMs free.", image: `${SHOT_BASE}/03-manufacturers.png`, durationSec: 4 },
      { kind: "demo", eyebrow: "End to end", headline: "Freight, tax, payouts. All on-platform.", image: `${SHOT_BASE}/13-ops-fulfillment.png`, durationSec: 4 },
      { kind: "cta", eyebrow: "PartsPort", headline: "Every part you need, in one search.", url: "partsport.com", durationSec: 4 },
    ],
  },
  ForDistributors: {
    id: "ForDistributors",
    brandSubtitle: "for distributors",
    scenes: [
      { kind: "hook", headline: "Sell to every utility buyer on the platform.", durationSec: 3 },
      { kind: "hook", headline: "Six percent. No listing fees.", durationSec: 2.6 },
      { kind: "demo", eyebrow: "Free to start", headline: "Single inbound channel for utility buyers.", image: `${SHOT_BASE}/05-suppliers-landing.png`, durationSec: 4 },
      { kind: "demo", eyebrow: "Your dashboard", headline: "Listings, units, orders, revenue, payouts.", image: `${SHOT_BASE}/08-supplier-dashboard.png`, durationSec: 4 },
      { kind: "demo", eyebrow: "Ten-item go-live gate", headline: "Ninety minutes once your W9, COI, license are ready.", image: `${SHOT_BASE}/08-supplier-dashboard.png`, durationSec: 4 },
      { kind: "demo", eyebrow: "What buyers see", headline: "Your spec sheets, your lead time, your pricing.", image: `${SHOT_BASE}/06-product-detail.png`, durationSec: 4 },
      { kind: "demo", eyebrow: "Real freight", headline: "Shippo quotes. Real labels. Auto-tracked.", image: `${SHOT_BASE}/13-ops-fulfillment.png`, durationSec: 4 },
      { kind: "demo", eyebrow: "Payouts", headline: "Stripe Connect. Two-day cycle after each shipment.", image: `${SHOT_BASE}/08-supplier-dashboard.png`, durationSec: 4 },
      { kind: "cta", eyebrow: "PartsPort", headline: "You only pay when you get paid.", url: "partsport.com", durationSec: 4 },
    ],
  },
  ForBuyers: {
    id: "ForBuyers",
    brandSubtitle: "for buyers",
    scenes: [
      { kind: "hook", headline: "Stop sending fourteen emails to find one part.", durationSec: 3 },
      { kind: "hook", headline: "One search. Vetted suppliers.", durationSec: 2.6 },
      { kind: "demo", eyebrow: "One search", headline: "Part number, spec, or plain English.", image: `${SHOT_BASE}/01-home.png`, durationSec: 4 },
      { kind: "demo", eyebrow: "Filter fast", headline: "In-stock, lead time, manufacturer, region.", image: `${SHOT_BASE}/02-catalog.png`, durationSec: 4 },
      { kind: "demo", eyebrow: "Real detail", headline: "Spec sheets. Datasheets. Real lead times.", image: `${SHOT_BASE}/06-product-detail.png`, durationSec: 4 },
      { kind: "demo", eyebrow: "Two lanes", headline: "Instant checkout. Or RFQ for anything over three K.", image: `${SHOT_BASE}/04-how-it-works.png`, durationSec: 4 },
      { kind: "demo", eyebrow: "One account", headline: "Orders, quotes, invoices, tracking. All in one place.", image: `${SHOT_BASE}/07-buyer-account.png`, durationSec: 4 },
      { kind: "cta", eyebrow: "PartsPort", headline: "Every part you need, in one search.", url: "partsport.com", durationSec: 4 },
    ],
  },
  ForManufacturers: {
    id: "ForManufacturers",
    brandSubtitle: "for manufacturers / oems",
    scenes: [
      { kind: "hook", headline: "Demand data on your category. Free.", durationSec: 3 },
      { kind: "hook", headline: "Every sale routes to your authorized distributors.", durationSec: 3 },
      { kind: "demo", eyebrow: "Brand storefronts", headline: "Your storefront on the catalog.", image: `${SHOT_BASE}/03-manufacturers.png`, durationSec: 4 },
      { kind: "demo", eyebrow: "Real demand", headline: "Live queries on your product lines. No black box.", image: `${SHOT_BASE}/14-oem-dashboard.png`, durationSec: 4 },
      { kind: "demo", eyebrow: "No channel conflict", headline: "We route demand into your existing distributor network.", image: `${SHOT_BASE}/14-oem-dashboard.png`, durationSec: 4 },
      { kind: "cta", eyebrow: "PartsPort", headline: "Free. No fee. Demand visibility for your category.", url: "partsport.com", durationSec: 4 },
    ],
  },
};

export const FPS = 30;
export const SIZE = 1080;
export const ASSET_HOST = "https://rok-preview-git-claude-industrial-marketplace-rowau-agentrad.vercel.app";

export function totalFrames(spec: VideoSpec): number {
  return Math.round(spec.scenes.reduce((sum, s) => sum + s.durationSec, 0) * FPS);
}
