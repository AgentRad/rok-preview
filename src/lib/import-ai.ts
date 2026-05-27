import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ImportMapping, ImportFilters } from "./import-mapping";
import { PARTSPORT_FIELDS } from "./import-mapping";

export const MAX_IMPORT_USER_MESSAGE_CHARS = 4000;

export function isImportAIEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM_PROMPT = `You are an AI assistant inside PartsPort's catalog import flow. A supplier just pasted or uploaded a messy spreadsheet of industrial parts (transformers, switchgear, breakers, conductors, etc.). Your job is to help them map the source columns to the PartsPort schema, set up filters that skip junk rows, and resolve ambiguities.

PartsPort schema fields you may map TO (the "dstField"):
${PARTSPORT_FIELDS.join(", ")}

Critical:
- sku, name, category, manufacturer are required. priceCents is required unless the row is quoteOnly.
- priceCents is stored in cents. If the source column is in dollars use transform { kind: "dollars-to-cents" }. If the source is already in cents use { kind: "identity" }.
- manufacturer must match an OEM brand that has claimed its name on PartsPort. Free-typed brand names will fail validation at commit.
- imageUrl must be http(s).
- quoteOnly is a boolean. Suppliers often write "B/O" (back-order / quote) or "call" in the price column to mean quote-only. Use proposed_filters.quoteOnlyIfPriceMatches with a regex like "^(b/o|call|quote|tbd)$" to handle that.
- Common junk rows: totals, subtotals, blank separator rows. Use proposed_filters.skipRowIf with "totals", "empty", or { regex: "..." }.

Tone: brief, technical, friendly. Explain what you changed and why in 1-3 short sentences.

OUTPUT FORMAT: at the very END of every reply, emit a single fenced JSON block, language tag "json", that the server will parse. Shape:

\`\`\`json
{
  "explanation": "short explanation, mirrors the prose above",
  "proposed_mapping": [
    { "srcColumn": "Cat#", "dstField": "sku" },
    { "srcColumn": "Price", "dstField": "priceCents", "transform": { "kind": "dollars-to-cents" } }
  ],
  "proposed_filters": { "skipRowIf": "totals" }
}
\`\`\`

The proposed_mapping array MUST list every source column exactly once. Use dstField: null for columns that should be ignored. Never invent a srcColumn that was not in the input.`;

export type ImportAIInput = {
  supplierContext: { id: string; name: string };
  currentMapping: ImportMapping;
  currentFilters: ImportFilters;
  headers: string[];
  sampleRows: Record<string, string>[];
  userMessage: string;
};

/**
 * Streams Anthropic text chunks as plain text. Supplier sample data
 * goes in the user-turn block, not the system prompt, so the system
 * cache_control hit rate stays high across follow-up messages.
 */
export async function* streamMappingHelp(
  input: ImportAIInput
): AsyncIterable<string> {
  const client = new Anthropic({ timeout: 30000, maxRetries: 1 });
  const dataBlob = {
    supplier: input.supplierContext,
    headers: input.headers,
    sampleRows: input.sampleRows.slice(0, 25),
    currentMapping: input.currentMapping,
    currentFilters: input.currentFilters,
  };

  const userTurn = `Here is the current parse state and my question.

DATA (JSON):
${JSON.stringify(dataBlob)}

QUESTION:
${input.userMessage}`;

  const stream = client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userTurn }],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}

/**
 * Pull the final ```json``` block out of a finished AI response. Returns
 * null if no parseable block is found (the caller keeps the prior
 * mapping in that case and surfaces the explanation text only).
 */
export function extractMappingProposal(
  text: string
): { explanation: string; proposed_mapping: ImportMapping; proposed_filters: ImportFilters } | null {
  // Find the LAST fenced json block.
  const re = /```json\s*([\s\S]*?)```/gi;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    last = m[1];
  }
  if (!last) return null;
  try {
    const parsed = JSON.parse(last.trim());
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.proposed_mapping)) return null;
    return {
      explanation: String(parsed.explanation ?? ""),
      proposed_mapping: parsed.proposed_mapping as ImportMapping,
      proposed_filters: (parsed.proposed_filters ?? {}) as ImportFilters,
    };
  } catch {
    return null;
  }
}
