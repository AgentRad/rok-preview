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
// Maps intents / applications / synonyms to catalog vocabulary.
const EXPANSIONS: Record<string, string[]> = {
  transformer: ["transformer", "pad-mount", "distribution", "kva"],
  breaker: ["breaker", "vacuum", "switchgear", "circuit"],
  switchgear: ["switchgear", "breaker", "vacuum"],
  cutout: ["cutout", "fused", "fuse"],
  relay: ["relay", "protection", "feeder", "sel"],
  protection: ["relay", "protection", "feeder"],
  conductor: ["conductor", "acsr", "overhead", "cable", "wire"],
  cable: ["cable", "conductor", "urd", "underground", "wire"],
  wire: ["wire", "conductor", "cable"],
  insulator: ["insulator", "polymer", "suspension"],
  meter: ["meter", "metering", "smart", "revenue", "ami"],
  generator: ["generator", "standby", "genset", "backup"],
  genset: ["generator", "standby", "backup"],
  backup: ["generator", "standby", "battery", "storage"],
  ats: ["transfer", "ats", "automatic"],
  solar: ["solar", "pv", "module", "panel", "photovoltaic"],
  pv: ["solar", "pv", "module"],
  panel: ["solar", "pv", "module"],
  inverter: ["inverter", "string", "solar"],
  battery: ["battery", "storage", "lfp", "bess"],
  storage: ["battery", "storage", "bess"],
  ground: ["ground", "grounding", "earth", "rod"],
  grounding: ["ground", "grounding", "rod"],
  surge: ["surge", "arrester", "lightning"],
  arrester: ["surge", "arrester"],
  scada: ["controller", "rtac", "automation", "scada"],
  controller: ["controller", "rtac", "automation"],
  "arc-flash": ["arc-flash", "ppe", "safety"],
  ppe: ["arc-flash", "ppe", "safety"],
  // applications
  substation: ["transformer", "breaker", "switchgear", "relay", "insulator"],
  feeder: ["relay", "conductor", "breaker"],
  overhead: ["conductor", "acsr", "insulator", "cutout"],
  underground: ["cable", "urd", "transformer"],
  outage: ["generator", "standby", "battery", "storage"],
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
    // Qualify on identity fields only — descriptions and supplier names are too noisy.
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

const SYSTEM = `You are the search engine for PartsPort, an energy & utilities equipment
marketplace (transformers, switchgear, relays, conductors, metering, generators, solar,
storage, grounding, SCADA). A buyer describes what they need — by part name,
specification, manufacturer, or the problem/application they are solving. Return the
catalog SKUs that genuinely fit the need, best match first. Understand intent, synonyms,
applications, and specs (e.g. "equipment for a new substation feeder" should surface
transformers, breakers, relays, and related gear). Only include SKUs that are reasonable
matches; omit irrelevant ones. If nothing in the catalog fits, return an empty list.
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
