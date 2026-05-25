import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Product, Supplier } from "@prisma/client";
import { prisma } from "./db";

export type SearchProduct = Product & { supplier: Supplier };

export type SearchResult = {
  interpretation: string;
  products: SearchProduct[];
  ai: boolean;
};

export function isAISearchEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/* ---------- heuristic fallback (no API key) ---------- */
// Maps intents / applications / synonyms to catalog vocabulary. Pull this
// hard when adding queries that should recall well: single-word category
// terms ("motor", "switchgear", "transformer") need to fan out to all the
// product families that buyer is plausibly looking at.
const EXPANSIONS: Record<string, string[]> = {
  // Transformers
  transformer: ["transformer", "pad-mount", "distribution", "kva", "auto", "dry-type"],
  kva: ["transformer", "kva"],
  "pad-mount": ["transformer", "pad-mount"],
  padmount: ["transformer", "pad-mount"],
  // Switching / breakers / motor control
  breaker: ["breaker", "vacuum", "switchgear", "circuit", "mccb", "molded"],
  switchgear: ["switchgear", "breaker", "vacuum", "mcc", "panelboard", "disconnect"],
  cutout: ["cutout", "fused", "fuse", "loadbreak"],
  fuse: ["fuse", "fused", "cutout", "current-limiting"],
  mcc: ["mcc", "motor", "control", "center", "starter"],
  motor: ["motor", "mcc", "starter", "control", "contactor", "protection", "relay"],
  contactor: ["contactor", "motor", "starter"],
  starter: ["starter", "motor", "mcc"],
  disconnect: ["disconnect", "switch", "switchgear"],
  panelboard: ["panelboard", "panel", "switchgear", "circuit"],
  // Relays / protection
  relay: ["relay", "protection", "feeder", "sel", "differential", "overcurrent"],
  protection: ["relay", "protection", "feeder", "differential", "overcurrent"],
  recloser: ["recloser", "relay", "protection", "vacuum"],
  feeder: ["relay", "conductor", "breaker", "protection"],
  // Conductors / cable
  conductor: ["conductor", "acsr", "aaac", "overhead", "cable", "wire"],
  cable: ["cable", "conductor", "urd", "underground", "wire", "service"],
  wire: ["wire", "conductor", "cable"],
  acsr: ["acsr", "conductor", "overhead"],
  // Line hardware
  insulator: ["insulator", "polymer", "suspension", "pin"],
  crossarm: ["crossarm", "fiberglass", "line", "hardware"],
  deadend: ["deadend", "clamp", "suspension"],
  // Metering
  meter: ["meter", "metering", "smart", "revenue", "ami", "smart-meter"],
  metering: ["meter", "metering", "smart", "revenue"],
  ct: ["ct", "current", "transformer", "metering"],
  ami: ["ami", "meter", "smart"],
  // Generators / ATS
  generator: ["generator", "standby", "genset", "backup", "diesel"],
  genset: ["generator", "standby", "backup"],
  diesel: ["diesel", "generator", "standby"],
  backup: ["generator", "standby", "battery", "storage", "ups"],
  ats: ["transfer", "ats", "automatic", "switch"],
  // Solar / inverters / storage
  solar: ["solar", "pv", "module", "panel", "photovoltaic", "inverter", "microinverter"],
  pv: ["solar", "pv", "module"],
  module: ["module", "solar", "pv", "panel"],
  panel: ["solar", "pv", "module"],
  inverter: ["inverter", "string", "solar", "microinverter", "hybrid"],
  microinverter: ["microinverter", "inverter", "solar"],
  racking: ["racking", "rail", "solar", "mount"],
  battery: ["battery", "storage", "lfp", "bess", "cell"],
  storage: ["battery", "storage", "bess", "ess"],
  bess: ["bess", "battery", "storage", "ess"],
  ess: ["ess", "storage", "battery"],
  // Grounding / surge
  ground: ["ground", "grounding", "earth", "rod", "clamp", "bond"],
  grounding: ["ground", "grounding", "rod"],
  rod: ["rod", "ground", "grounding"],
  surge: ["surge", "arrester", "lightning"],
  arrester: ["surge", "arrester"],
  // SCADA / controls
  scada: ["controller", "rtac", "rtu", "automation", "scada"],
  rtu: ["rtu", "scada", "automation"],
  rtac: ["rtac", "scada", "controller"],
  controller: ["controller", "rtac", "automation"],
  automation: ["automation", "scada", "controller", "rtu"],
  // Safety / PPE
  "arc-flash": ["arc-flash", "ppe", "safety"],
  ppe: ["arc-flash", "ppe", "safety", "gloves"],
  gloves: ["gloves", "rubber", "ppe", "safety"],
  voltage: ["voltage", "detector", "tester", "ppe"],
  // Applications
  substation: ["transformer", "breaker", "switchgear", "relay", "insulator"],
  overhead: ["conductor", "acsr", "insulator", "cutout"],
  underground: ["cable", "urd", "transformer"],
  outage: ["generator", "standby", "battery", "storage"],
  utility: ["transformer", "cable", "conductor", "insulator", "meter"],
  industrial: ["mcc", "breaker", "motor", "panelboard"],
};

const STOPWORDS = new Set([
  "for", "the", "and", "with", "to", "of", "in", "on", "my", "need", "needs",
  "want", "looking", "look", "find", "get", "me", "is", "are", "that", "this",
  "we", "our", "you", "your", "new", "buy", "some", "any", "from", "by", "at",
]);

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function heuristicRank(query: string, products: SearchProduct[]): SearchProduct[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return products;

  const terms = new Set<string>();
  for (const t of tokens) {
    terms.add(t);
    for (const e of EXPANSIONS[t] || []) terms.add(e);
  }

  const scored = products.map((p) => {
    const name = p.name.toLowerCase();
    const category = p.category.toLowerCase();
    const sku = p.sku.toLowerCase();
    // Qualify on identity fields only; descriptions and supplier names are too noisy.
    const hay = `${name} ${p.manufacturer.toLowerCase()} ${category} ${sku}`;
    let score = 0;
    for (const term of terms) {
      if (!hay.includes(term)) continue;
      score += 1;
      if (name.includes(term)) score += 3;
      if (category.includes(term)) score += 3;
      if (sku.includes(term)) score += 4;
    }
    return { p, score };
  });

  const hits = scored.filter((s) => s.score > 0);
  if (hits.length === 0) return [];
  hits.sort((a, b) => b.score - a.score);
  return hits.map((s) => s.p);
}

/* ---------- AI search (Claude) ---------- */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    interpretation: {
      type: "string",
      description: "One short sentence describing what the buyer is looking for.",
    },
    skus: {
      type: "array",
      items: { type: "string" },
      description: "Matching product SKUs, best match first. Empty if nothing fits.",
    },
  },
  required: ["interpretation", "skus"],
} as const;

const SYSTEM = `You are the search engine for PartsPort, an industrial parts and equipment
marketplace. A buyer describes what they need, by part name, specification,
manufacturer, or the problem/application they are solving. Using only the catalog
provided, return the SKUs that genuinely fit the need, best match first. Understand
intent, synonyms, applications, and specs.

Recall guidance (important for industrial spec searches):
- When the buyer names a rating (e.g. "75 kVA transformer", "15 kV breaker", "100 A
  cutout"), return both exact-rating matches AND the adjacent typical ratings (the
  next size up and the next size down within the same product family). Industrial
  buyers often round to nearest standard size; they want to compare options.
- When the buyer types a single GENERIC word (e.g. "motor", "transformer",
  "switchgear", "relay", "solar", "cable"), interpret it as a category query and
  return EVERY plausibly-matching SKU in the catalog, not just exact-name hits.
  Examples:
    "motor"    -> motor control centers, motor protection relays, starters,
                  contactors, feeder protection relays
    "solar"    -> PV modules, microinverters, string inverters, racking
    "cable"    -> URD, MV-105, service-entrance, control cable, conductors
  Single-word queries should typically return 5-15 results, not 1.
- When the buyer names a category but not a brand, return options across multiple
  manufacturers so the buyer can compare price and lead time.
- Aim for 5 to 12 results when the catalog supports it. Single-result returns are
  usually wrong unless the query is a SKU or a very specific brand-and-model match.
- Only return ZERO results when nothing in the catalog plausibly serves the need.

Keep "interpretation" to one plain sentence.`;

async function aiRank(
  query: string,
  products: SearchProduct[]
): Promise<{ interpretation: string; products: SearchProduct[] } | null> {
  try {
    const client = new Anthropic({ timeout: 15000, maxRetries: 1 });
    const catalog = products
      .map(
        (p) =>
          `${p.sku} | ${p.name} | ${p.category} | ${p.manufacturer} | $${(
            p.priceCents / 100
          ).toFixed(2)}/${p.unit} | lead ${p.etaDays}d | ${
            p.stock > 0 ? "in stock" : "backorder"
          }`
      )
      .join("\n");

    const res = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 512,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
      system: [
        { type: "text", text: SYSTEM },
        {
          type: "text",
          text: `Catalog:\n${catalog}`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: `Buyer query: "${query}"` }],
    });

    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return null;
    const parsed = JSON.parse(text.text) as {
      interpretation: string;
      skus: string[];
    };

    const bySku = new Map(products.map((p) => [p.sku, p]));
    const ranked = parsed.skus
      .map((s) => bySku.get(s))
      .filter((p): p is SearchProduct => Boolean(p));

    return { interpretation: parsed.interpretation, products: ranked };
  } catch {
    return null;
  }
}

/* ---------- fast instant search (for the live hero) ---------- */
// Keyword-only, no AI call, no logging; safe to hit on every keystroke.
export async function quickSearch(query: string): Promise<SearchProduct[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const products = await prisma.product.findMany({
    where: { active: true },
    include: { supplier: true },
  });
  return heuristicRank(q, products);
}

/* ---------- entry point ---------- */
export async function runSearch(query: string): Promise<SearchResult> {
  const products = await prisma.product.findMany({
    where: { active: true },
    include: { supplier: true },
  });

  const q = query.trim();
  if (!q) {
    return { interpretation: "", products, ai: false };
  }

  // Log the query as demand signal (surfaced to manufacturers).
  try {
    await prisma.searchEvent.create({ data: { query: q } });
  } catch {
    /* non-fatal */
  }

  if (isAISearchEnabled()) {
    const ai = await aiRank(q, products);
    if (ai) {
      return { interpretation: ai.interpretation, products: ai.products, ai: true };
    }
  }

  return {
    interpretation: `Showing parts matched to “${q}”.`,
    products: heuristicRank(q, products),
    ai: false,
  };
}
