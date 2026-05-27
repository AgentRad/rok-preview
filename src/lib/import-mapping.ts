/**
 * PLH-3f: pure mapping primitives for the conversational AI catalog
 * import assistant. No Prisma imports, no I/O. The route layer owns
 * DB writes and validation that needs the manufacturer roster.
 */

import { ICON_KEYS } from "@/components/PartIcon";

export const PARTSPORT_FIELDS = [
  "sku",
  "name",
  "category",
  "manufacturer",
  "priceCents",
  "stock",
  "etaDays",
  "weightLbs",
  "lengthIn",
  "widthIn",
  "heightIn",
  "freightClass",
  "imageUrl",
  "images",
  "description",
  "unit",
  "quoteOnly",
  "icon",
] as const;

// PLH-3h P4: hard cap on number of image URLs per product row at import time.
// Mirrors the per-product cap enforced by the supplier image manager UI.
export const MAX_IMAGES_PER_ROW = 12;

export type PartsPortField = (typeof PARTSPORT_FIELDS)[number];

export type Transform =
  | { kind: "identity" }
  | { kind: "cents-to-dollars" }
  | { kind: "dollars-to-cents" }
  | { kind: "literal"; literal: string }
  | { kind: "boolean" };

export type ImportMappingEntry = {
  srcColumn: string;
  dstField: PartsPortField | null;
  transform?: Transform;
};

export type ImportMapping = ImportMappingEntry[];

export type ImportFilters = {
  skipRowIf?: "totals" | "empty" | { regex: string };
  quoteOnlyIfPriceMatches?: string; // regex against the price source cell
};

/**
 * Canonical PartsPort row shape produced by applyMapping. Mirrors the
 * route-level normalizeRow output so the existing PLH-2 Phase 4a commit
 * loop can consume it unchanged.
 */
export type CanonicalRow = {
  rowNumber: number;
  sku: string;
  name: string;
  category: string;
  manufacturer: string;
  icon: string;
  priceCents: number;
  unit: string;
  etaDays: number;
  stock: number;
  description: string;
  imageUrl: string;
  // PLH-3h P4: multi-image support. Accumulated from any column(s)
  // mapped to `images`, plus the legacy single `imageUrl` if present.
  // Deduped, order-preserving, capped at MAX_IMAGES_PER_ROW.
  imageUrls: string[];
  quoteOnly: boolean;
  weightLbs: number | null;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
  freightClass: string | null;
  // Echo of the literal source row to feed the preview UI.
  srcRow: Record<string, string>;
};

// Header similarity heuristics. Each PartsPort field has a list of
// likely source-column names (lowercased, stripped of punctuation).
const HEADER_HINTS: Record<PartsPortField, string[]> = {
  sku: ["sku", "partnumber", "partno", "item", "itemnumber", "itemno", "cat", "catnumber", "catalog", "code", "modelnumber", "model"],
  name: ["name", "partname", "description", "item description", "product", "productname", "title"],
  category: ["category", "type", "class", "family", "group"],
  manufacturer: ["manufacturer", "brand", "make", "oem", "vendor"],
  priceCents: ["price", "cost", "unitprice", "list", "listprice", "pricecents", "msrp", "amount"],
  stock: ["stock", "qty", "quantity", "onhand", "available", "inventory"],
  etaDays: ["etadays", "eta", "leadtime", "leadtimedays", "lead"],
  weightLbs: ["weight", "weightlbs", "lbs", "pounds"],
  lengthIn: ["length", "lengthin", "lengthinches", "l"],
  widthIn: ["width", "widthin", "widthinches", "w"],
  heightIn: ["height", "heightin", "heightinches", "h"],
  freightClass: ["freightclass", "nmfc", "class"],
  imageUrl: ["imageurl", "image", "photo", "picture", "img"],
  images: ["images", "imageurls", "photos", "pictures", "imgs", "gallery", "image1", "image2", "image3", "image4", "image5", "image6", "image7", "image8", "image9", "image10", "image11", "image12", "photo1", "photo2", "photo3", "photo4", "photo5", "img1", "img2", "img3", "img4", "img5"],
  description: ["description", "longdescription", "notes", "details"],
  unit: ["unit", "uom", "units"],
  quoteOnly: ["quoteonly", "quote", "bo", "callforprice", "cfp"],
  icon: ["icon"],
};

function normHeader(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Heuristic, no-AI first pass over raw headers. Picks the obvious
 * matches by header similarity. Unmatched columns get dstField: null
 * so the supplier can wire them up via chat.
 */
export function inferMapping(rawHeaders: string[]): ImportMapping {
  const used = new Set<PartsPortField>();
  const out: ImportMapping = [];
  for (const h of rawHeaders) {
    const norm = normHeader(h);
    let pick: PartsPortField | null = null;
    let pickScore = 0;
    // PLH-3h P4: header that smells like an image column (contains
    // image/photo/pic/img or "url") routes to `images` so multiple
    // image* columns all roll up into one canonical array.
    const looksImagey = /(image|photo|pic|img|gallery)/.test(norm);
    if (looksImagey) {
      pick = "images";
      pickScore = 3;
    }
    for (const field of PARTSPORT_FIELDS) {
      // `images` can be assigned to many source columns; don't gate on used.
      if (field !== "images" && used.has(field)) continue;
      for (const hint of HEADER_HINTS[field]) {
        // Exact match wins.
        if (norm === hint && pickScore < 3) {
          pick = field;
          pickScore = 3;
        } else if (norm.includes(hint) && pickScore < 2) {
          pick = field;
          pickScore = 2;
        } else if (hint.includes(norm) && norm.length >= 3 && pickScore < 1) {
          pick = field;
          pickScore = 1;
        }
      }
    }
    if (pick && pick !== "images") used.add(pick);
    // priceCents default transform: dollars-to-cents (most spreadsheets
    // ship in dollars). The AI can flip this to identity (already cents)
    // or cents-to-dollars on user instruction.
    const transform: Transform | undefined =
      pick === "priceCents" ? { kind: "dollars-to-cents" } : undefined;
    out.push({ srcColumn: h, dstField: pick, transform });
  }
  return out;
}

function cleanNumber(raw: string): number | null {
  if (!raw) return null;
  const s = String(raw).replace(/[$,\s]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

function applyTransform(
  raw: string,
  field: PartsPortField,
  transform: Transform | undefined
): unknown {
  if (transform?.kind === "literal") return transform.literal;
  const isNumberField =
    field === "priceCents" ||
    field === "stock" ||
    field === "etaDays" ||
    field === "weightLbs" ||
    field === "lengthIn" ||
    field === "widthIn" ||
    field === "heightIn";
  if (isNumberField) {
    const n = cleanNumber(raw);
    if (n === null) return null;
    if (field === "priceCents") {
      if (transform?.kind === "dollars-to-cents") return Math.round(n * 100);
      if (transform?.kind === "cents-to-dollars") return Math.round(n);
      // Default: assume dollars input even if no explicit transform, since
      // priceCents is the destination unit and most catalogs are dollars.
      return Math.round(n * 100);
    }
    return n;
  }
  if (field === "quoteOnly") {
    const t = String(raw).trim().toLowerCase();
    return (
      t === "true" ||
      t === "1" ||
      t === "yes" ||
      t === "y" ||
      t === "quote" ||
      t === "quote only" ||
      t === "quote-only" ||
      t === "bo" ||
      t === "b/o"
    );
  }
  return raw;
}

function shouldSkipRow(
  row: Record<string, string>,
  filters: ImportFilters
): boolean {
  if (!filters.skipRowIf) return false;
  const cells = Object.values(row).map((v) => String(v ?? "").trim());
  if (filters.skipRowIf === "empty") {
    return cells.every((c) => c.length === 0);
  }
  if (filters.skipRowIf === "totals") {
    const joined = cells.join(" ").toLowerCase();
    return /\b(total|subtotal|grand total|sum)\b/.test(joined);
  }
  if (typeof filters.skipRowIf === "object" && filters.skipRowIf.regex) {
    try {
      const re = new RegExp(filters.skipRowIf.regex, "i");
      return cells.some((c) => re.test(c));
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Apply a mapping + filters to raw rows, producing the canonical
 * PartsPort row shape. Filters drop rows; mapping transforms cells.
 * Errors at the field level become empty / zero values and are caught
 * later by validateRow.
 */
export function applyMapping(
  rows: Record<string, string>[],
  mapping: ImportMapping,
  filters: ImportFilters = {}
): CanonicalRow[] {
  const out: CanonicalRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (shouldSkipRow(row, filters)) continue;
    const acc: Partial<CanonicalRow> & { srcRow: Record<string, string> } = {
      rowNumber: i + 2, // +2 because header is row 1
      srcRow: row,
    };
    let priceSrc = "";
    // PLH-3h P4: accumulate URLs from any column mapped to `images`,
    // plus the legacy single `imageUrl` column. Supports either
    // pipe-separated or comma-separated URLs in a single cell.
    const imageAcc: string[] = [];
    for (const m of mapping) {
      if (!m.dstField) continue;
      const raw = row[m.srcColumn] ?? "";
      if (m.dstField === "priceCents") priceSrc = String(raw);
      if (m.dstField === "images") {
        const cell = String(raw).trim();
        if (cell) {
          // Split on pipe first (canonical), then on comma. Whitespace
          // around tokens is normalized.
          const parts = cell
            .split(/\||,/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          for (const p of parts) imageAcc.push(p);
        }
        continue;
      }
      const v = applyTransform(String(raw), m.dstField, m.transform);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (acc as any)[m.dstField] = v;
    }
    // Legacy single imageUrl also seeds the array so consumers only need
    // to read imageUrls.
    if (typeof acc.imageUrl === "string" && acc.imageUrl.trim()) {
      imageAcc.unshift(acc.imageUrl.trim());
    }
    // Dedup, order-preserving.
    const seenUrl = new Set<string>();
    const imageUrls: string[] = [];
    for (const u of imageAcc) {
      if (seenUrl.has(u)) continue;
      seenUrl.add(u);
      imageUrls.push(u);
    }

    // quoteOnly heuristic from price-source regex.
    let quoteOnly = Boolean(acc.quoteOnly);
    if (!quoteOnly && filters.quoteOnlyIfPriceMatches) {
      try {
        const re = new RegExp(filters.quoteOnlyIfPriceMatches, "i");
        if (re.test(priceSrc)) quoteOnly = true;
      } catch {
        /* invalid regex, ignore */
      }
    }

    const iconRaw = String(acc.icon || "").toLowerCase();
    const icon = ICON_KEYS.includes(iconRaw) ? iconRaw : "gear";

    const priceCents =
      typeof acc.priceCents === "number" && Number.isFinite(acc.priceCents)
        ? Math.max(0, Math.round(acc.priceCents))
        : 0;
    const stock =
      typeof acc.stock === "number" && Number.isFinite(acc.stock)
        ? Math.max(0, Math.floor(acc.stock))
        : 0;
    const etaDays =
      typeof acc.etaDays === "number" && Number.isFinite(acc.etaDays)
        ? Math.max(1, Math.min(90, Math.floor(acc.etaDays)))
        : 3;

    const canonical: CanonicalRow = {
      rowNumber: acc.rowNumber!,
      sku: String(acc.sku || "").trim().toUpperCase(),
      name: String(acc.name || "").trim(),
      category: String(acc.category || "").trim(),
      manufacturer: String(acc.manufacturer || "").trim(),
      icon,
      priceCents,
      unit: String(acc.unit || "each").trim() || "each",
      etaDays,
      stock,
      description: String(acc.description || "").trim(),
      imageUrl: String(acc.imageUrl || imageUrls[0] || "").trim(),
      imageUrls,
      quoteOnly,
      weightLbs:
        typeof acc.weightLbs === "number" && Number.isFinite(acc.weightLbs)
          ? acc.weightLbs
          : null,
      lengthIn:
        typeof acc.lengthIn === "number" && Number.isFinite(acc.lengthIn)
          ? acc.lengthIn
          : null,
      widthIn:
        typeof acc.widthIn === "number" && Number.isFinite(acc.widthIn)
          ? acc.widthIn
          : null,
      heightIn:
        typeof acc.heightIn === "number" && Number.isFinite(acc.heightIn)
          ? acc.heightIn
          : null,
      freightClass: acc.freightClass ? String(acc.freightClass).trim() : null,
      srcRow: row,
    };
    out.push(canonical);
  }
  return out;
}

/**
 * Synchronous field-level validation. Manufacturer-claimed check happens
 * separately at the route layer (needs Prisma).
 */
export function validateRow(row: CanonicalRow): {
  ok: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!row.sku) errors.push("Missing SKU");
  if (!row.name) errors.push("Missing name");
  if (!row.category) errors.push("Missing category");
  if (!row.manufacturer) errors.push("Missing manufacturer");
  if (!row.quoteOnly && !(row.priceCents > 0)) errors.push("Price must be > 0");
  // PLH-3h P4: validate each URL in imageUrls. Cap at MAX_IMAGES_PER_ROW;
  // drop extras with a warning. Any URL that fails new URL() or is not
  // http(s) fails the whole row. URL-supplied images cannot be magic-byte
  // sniffed without fetching each one (expensive), so URL parse + scheme
  // check is the only line of defense here.
  if (row.imageUrls && row.imageUrls.length > 0) {
    if (row.imageUrls.length > MAX_IMAGES_PER_ROW) {
      const dropped = row.imageUrls.length - MAX_IMAGES_PER_ROW;
      warnings.push(
        `Dropped ${dropped} extra image URL${dropped === 1 ? "" : "s"} (cap is ${MAX_IMAGES_PER_ROW}).`
      );
      row.imageUrls = row.imageUrls.slice(0, MAX_IMAGES_PER_ROW);
    }
    for (const u of row.imageUrls) {
      try {
        const parsed = new URL(u);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          errors.push(`Image URL must be http or https: ${u}`);
        }
      } catch {
        errors.push(`Image URL is not valid: ${u}`);
      }
    }
  } else if (row.imageUrl) {
    // Legacy single-image path (no images mapping in play).
    try {
      const u = new URL(row.imageUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") {
        errors.push("imageUrl must be http or https");
      }
    } catch {
      errors.push("imageUrl is not a valid URL");
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Best-effort delimiter detection from the first ~10 lines. Used by the
 * server-side parse action.
 */
export function detectDelimiter(text: string): "," | "\t" | ";" {
  const head = text.split(/\r?\n/).slice(0, 10).join("\n");
  const counts = {
    ",": (head.match(/,/g) || []).length,
    "\t": (head.match(/\t/g) || []).length,
    ";": (head.match(/;/g) || []).length,
  };
  let best: "," | "\t" | ";" = ",";
  let bestN = counts[","];
  if (counts["\t"] > bestN) {
    best = "\t";
    bestN = counts["\t"];
  }
  if (counts[";"] > bestN) {
    best = ";";
    bestN = counts[";"];
  }
  return best;
}
