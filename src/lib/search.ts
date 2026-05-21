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
  motor: ["motor", "drive", "tefc", "three-phase"],
  drive: ["drive", "vfd", "motor", "inverter"],
  vfd: ["drive", "powerflex", "inverter", "frequency"],
  inverter: ["drive", "vfd", "powerflex"],
  pump: ["pump", "hydraulic", "gear"],
  bearing: ["bearing", "ball", "deep groove"],
  belt: ["belt", "timing", "synchronous", "powergrip"],
  pulley: ["belt", "pulley"],
  valve: ["valve", "ball valve", "shutoff"],
  seal: ["seal", "gasket", "sealing"],
  "o-ring": ["seal", "gasket"],
  gasket: ["gasket", "seal", "sheet"],
  sensor: ["sensor", "photoelectric", "laser", "proximity"],
  detect: ["sensor", "photoelectric", "laser"],
  bolt: ["bolt", "screw", "hex", "fastener", "cap screw"],
  screw: ["screw", "bolt", "hex", "fastener"],
  fastener: ["fastener", "bolt", "screw", "hex"],
  coupling: ["coupling", "jaw", "flexible"],
  gearbox: ["gearbox", "reducer", "helical"],
  reducer: ["gearbox", "helical", "reducer"],
  hose: ["hose", "hydraulic", "assembly"],
  cutting: ["insert", "carbide", "turning"],
  tooling: ["insert", "carbide", "cutting"],
  insert: ["insert", "carbide", "turning"],
  contactor: ["contactor", "switching"],
  relay: ["contactor"],
  // applications
  conveyor: ["motor", "belt", "bearing", "gearbox", "coupling", "drive"],
  pneumatic: ["pneumatic", "cylinder", "air"],
  hydraulic: ["hydraulic", "pump", "hose"],
  leak: ["valve", "seal", "gasket"],
  rotating: ["bearing", "motor", "coupling"],
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

const SYSTEM = `You are the search engine for PartsPort, an industrial parts marketplace.
A buyer describes what they need — by part name, specification, manufacturer, or the
problem/application they are solving. Return the catalog SKUs that genuinely fit the
need, best match first. Understand intent, synonyms, applications, and specs (e.g.
"motor for a conveyor" should surface motors, drives, and related power-transmission
parts). Only include SKUs that are reasonable matches; omit irrelevant ones. If nothing
in the catalog fits, return an empty list. Keep "interpretation" to one plain sentence.`;

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
