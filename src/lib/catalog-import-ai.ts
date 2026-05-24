import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Bounded, human-reviewed AI cleanup for catalog uploads.
 *
 * The platform never lets the model silently change a price or a spec. The
 * raw input is mapped to structured rows; anything ambiguous is flagged via
 * `confidence: "low"` and `notes`, and the supplier reviews everything before
 * any of it goes live (the existing /api/supplier/catalog-import preview
 * flow).
 */

export type AICatalogRow = {
  sku: string;
  name: string;
  category: string;
  manufacturer: string;
  price: number;
  unit: string;
  etaDays: number;
  stock: number;
  description: string;
  quoteOnly: boolean;
  imageUrl: string;
  confidence: "high" | "medium" | "low";
  notes: string;
};

export function isCatalogAIEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sku: {
            type: "string",
            description: "Part number / SKU exactly as the supplier wrote it. Uppercase. Required.",
          },
          name: {
            type: "string",
            description: "Short product name. Required.",
          },
          category: {
            type: "string",
            description:
              "Best-fit category. Prefer one of: Transformers, Switchgear & Breakers, Protective Relays, Conductors & Cable, Line Hardware, Metering, Generators & ATS, Solar & Inverters, Energy Storage, Grounding & Surge, Controls & SCADA, Safety & Arc-Flash. If none fit, return a short category name verbatim from the input.",
          },
          manufacturer: {
            type: "string",
            description: "OEM brand. Use the supplier's company name only if no separate OEM brand is identifiable.",
          },
          price: {
            type: "number",
            description: "List price in USD. 0 if the input clearly has no price.",
          },
          unit: {
            type: "string",
            description: 'Pricing unit. Default "each". Other examples: "per ft", "per lb".',
          },
          etaDays: {
            type: "number",
            description: "Typical lead time in business days. 7 if not stated.",
          },
          stock: {
            type: "number",
            description: "Stock on hand. 0 if backorder, made-to-order, or quote-only.",
          },
          description: {
            type: "string",
            description: "One short sentence about the product. Empty string if not in the input.",
          },
          quoteOnly: {
            type: "boolean",
            description:
              "true when the item is configured, requires sizing, or has no fixed price (typical for items above about $3,000). false for stocked commodity parts.",
          },
          imageUrl: {
            type: "string",
            description: "Photo URL if present in the input. Empty string otherwise.",
          },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
            description:
              "high when every required field is unambiguous. medium when there are minor gaps. low when the row needs human review.",
          },
          notes: {
            type: "string",
            description:
              "Brief plain-English flag for the human reviewer. Empty when nothing is unclear. Use this for assumptions you made (e.g., 'assumed each as unit', 'price unclear, set to 0').",
          },
        },
        required: [
          "sku",
          "name",
          "category",
          "manufacturer",
          "price",
          "unit",
          "etaDays",
          "stock",
          "description",
          "quoteOnly",
          "imageUrl",
          "confidence",
          "notes",
        ],
      },
    },
  },
  required: ["rows"],
} as const;

const SYSTEM = `You are a strict catalog import assistant for PartsPort, an industrial parts marketplace. You convert messy supplier input (CSV with bad headers, a pasted price sheet, an Excel screenshot description, an email body) into clean structured product rows.

Hard rules:
1. Never invent or alter a price, SKU, specification, or unit. If the input does not give a value, use the default in the field description and flag it in "notes".
2. Never collapse two distinct products into one row. If unsure, emit a row with confidence "low" and explain in "notes".
3. SKUs must be unique within your output. If the input has duplicates, keep the first and skip later ones (note this).
4. If a field clearly does not apply (e.g., stock for a quote-only item), use the documented default and note it.
5. Output strictly matches the JSON schema. Do not add fields. Do not omit required ones.
6. The supplier reviews every row before anything goes live. Your job is to be honest about uncertainty, not to look smart.`;

export async function cleanupCatalog(input: string): Promise<AICatalogRow[]> {
  if (!isCatalogAIEnabled()) {
    throw new Error("ANTHROPIC_API_KEY is not set; AI catalog cleanup is disabled.");
  }

  const trimmed = input.trim();
  if (!trimmed) return [];
  if (trimmed.length > 60_000) {
    throw new Error(
      "Input is over the 60k character cap. Split it into smaller batches and re-run."
    );
  }

  const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
  const res = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 8000,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: SCHEMA },
    },
    system: [{ type: "text", text: SYSTEM }],
    messages: [
      {
        role: "user",
        content: `Convert the supplier input below into structured rows.\n\nSupplier input:\n---\n${trimmed}\n---`,
      },
    ],
  });

  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return [];
  const parsed = JSON.parse(text.text) as { rows: AICatalogRow[] };
  return Array.isArray(parsed.rows) ? parsed.rows : [];
}

/** Renders the cleaned rows back into the platform's catalog CSV shape so the
 *  supplier sees a familiar preview before they import.
 */
export function rowsToCsv(rows: AICatalogRow[]): string {
  const header = [
    "sku",
    "name",
    "category",
    "manufacturer",
    "price",
    "unit",
    "etaDays",
    "stock",
    "quoteOnly",
    "description",
    "imageUrl",
  ];

  function cell(v: unknown): string {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  const lines: string[] = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.sku,
        r.name,
        r.category,
        r.manufacturer,
        r.price,
        r.unit,
        r.etaDays,
        r.stock,
        r.quoteOnly ? "true" : "false",
        r.description,
        r.imageUrl,
      ]
        .map(cell)
        .join(",")
    );
  }
  return lines.join("\n") + "\n";
}
