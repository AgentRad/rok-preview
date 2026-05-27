import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { parseCsv, parseCsvWithHeader } from "@/lib/csv";
import { canEditCatalog, getActiveSupplierContext } from "@/lib/supplier-access";
import { rateLimit } from "@/lib/rate-limit";
import { isClaimedManufacturer } from "@/lib/manufacturers";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";
import {
  type ImportMapping,
  type ImportFilters,
  type CanonicalRow,
  applyMapping,
  inferMapping,
  detectDelimiter,
  validateRow,
} from "@/lib/import-mapping";
import {
  isImportAIEnabled,
  streamMappingHelp,
  MAX_IMPORT_USER_MESSAGE_CHARS,
} from "@/lib/import-ai";

// PLH-2 Phase 4a (A4): 2 MB cap on raw catalog text.
const MAX_RAW_BYTES = 2 * 1024 * 1024;
// PLH-2 Phase 4a (A1): batched transactional commit.
const COMMIT_BATCH_SIZE = 100;
const SAMPLE_ROW_CAP = 25;

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Auth + rate-limit helper used by every action.
// ---------------------------------------------------------------------------
async function authorize(action: "parse" | "chat" | "commit") {
  const user = await getCurrentUser();
  if (!user || (user.role !== "SUPPLIER" && user.role !== "ADMIN")) {
    return {
      err: NextResponse.json({ error: "Not authorized." }, { status: 403 }),
    };
  }
  const ctx = await getActiveSupplierContext(user);
  if (!ctx) {
    return {
      err: NextResponse.json(
        {
          error:
            user.role === "ADMIN"
              ? "Use 'Manage as' on /admin to act as a specific supplier first."
              : "No supplier profile linked to this account.",
        },
        { status: 400 }
      ),
    };
  }
  if (!canEditCatalog(ctx.role)) {
    return {
      err: NextResponse.json(
        { error: "Your role doesn't allow editing the catalog." },
        { status: 403 }
      ),
    };
  }
  const bucket = action === "chat" ? "import-ai" : "catalog-import";
  const rl = await rateLimit(bucket, `supplier:${ctx.supplier.id}`);
  if (!rl.allowed) {
    return {
      err: NextResponse.json(
        { error: "Too many requests. Try again in a moment." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
        }
      ),
    };
  }
  return { user, ctx };
}

// ---------------------------------------------------------------------------
// Parse helpers. Two input shapes: raw text (CSV/TSV) or base64 .xlsx.
// ---------------------------------------------------------------------------
type ParsedInput = {
  delimiter: "," | "\t" | ";" | "xlsx";
  headers: string[];
  rows: Record<string, string>[];
};

function parseDelimited(text: string): ParsedInput {
  // Strip BOM.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delim = detectDelimiter(text);
  // Re-use parseCsv for comma; for tab/semicolon do a simple transform to
  // commas only if the line doesn't already contain quoted commas. Safer
  // path: split lines, then split each line on the detected delimiter,
  // but respect quoting via a minimal pass.
  if (delim === ",") {
    const rows = parseCsvWithHeader(text);
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { delimiter: delim, headers, rows };
  }
  // For tab/semicolon, rewrite to comma by routing through parseCsv with a
  // custom split. The existing parser is comma-only; the cheapest correct
  // path is a per-line, quote-aware split.
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0)
    return { delimiter: delim, headers: [], rows: [] };
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') {
          q = false;
        } else {
          cur += c;
        }
      } else if (c === '"') {
        q = true;
      } else if (c === delim) {
        out.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out;
  };
  const headers = split(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = split(line);
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = (cells[i] ?? "").trim();
    }
    return obj;
  });
  return { delimiter: delim, headers, rows };
}

function parseXlsx(base64: string): ParsedInput {
  const buf = Buffer.from(base64, "base64");
  if (buf.byteLength > MAX_RAW_BYTES) {
    throw new Error("XLSX too large. Maximum 2 MB.");
  }
  const wb = XLSX.read(buf, { type: "buffer" });
  const first = wb.SheetNames[0];
  if (!first) return { delimiter: "xlsx", headers: [], rows: [] };
  const sheet = wb.Sheets[first];
  const aoa = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  if (aoa.length === 0) return { delimiter: "xlsx", headers: [], rows: [] };
  const headers = (aoa[0] || []).map((h) => String(h).trim());
  const rows = aoa.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = String((cells as string[])[i] ?? "").trim();
    }
    return obj;
  });
  return { delimiter: "xlsx", headers, rows };
}

function parseInput(body: {
  raw?: string;
  kind?: string;
  fileBase64?: string;
}): ParsedInput {
  if (body.fileBase64 && body.kind === "xlsx") {
    return parseXlsx(body.fileBase64);
  }
  const raw = String(body.raw || "");
  if (Buffer.byteLength(raw, "utf8") > MAX_RAW_BYTES) {
    throw new Error("Input too large. Maximum 2 MB.");
  }
  return parseDelimited(raw);
}

// ---------------------------------------------------------------------------
// Commit helper. Reuses the PLH-2 Phase 4a batched-transaction code path,
// now driven by canonical rows produced via applyMapping rather than the
// old normalizeRow.
// ---------------------------------------------------------------------------
async function commitRows(
  rows: CanonicalRow[],
  supplierId: string,
  supplierName: string
): Promise<{
  ok: boolean;
  counts: { total: number; created: number; updated: number; invalid: number };
  committedBatches: number;
  totalBatches: number;
  failedAtBatch: number | null;
  batchError: string | null;
  partialResults: { rowNumber: number; error: string }[];
  rowErrors: { rowNumber: number; error: string }[];
}> {
  const rowErrors: { rowNumber: number; error: string }[] = [];

  // Field-level validation up front.
  const validated: CanonicalRow[] = [];
  for (const r of rows) {
    const v = validateRow(r);
    if (!v.ok) {
      rowErrors.push({ rowNumber: r.rowNumber, error: v.errors.join("; ") });
      continue;
    }
    validated.push(r);
  }

  // Manufacturer-claimed check (DB-backed). Cache per unique brand string
  // so we don't N+1 a 500-row import.
  const claimCache = new Map<string, boolean>();
  const claimable: CanonicalRow[] = [];
  for (const r of validated) {
    const key = r.manufacturer.toLowerCase();
    let ok = claimCache.get(key);
    if (ok === undefined) {
      ok = await isClaimedManufacturer(r.manufacturer);
      claimCache.set(key, ok);
    }
    if (!ok) {
      rowErrors.push({
        rowNumber: r.rowNumber,
        error: "Brand not claimed on PartsPort.",
      });
      continue;
    }
    claimable.push(r);
  }

  // In-file duplicate SKU detection.
  const seen = new Map<string, number>();
  const deduped: CanonicalRow[] = [];
  for (const r of claimable) {
    if (seen.has(r.sku)) {
      rowErrors.push({
        rowNumber: r.rowNumber,
        error: `Duplicate SKU in this file (also row ${seen.get(r.sku)})`,
      });
      continue;
    }
    seen.set(r.sku, r.rowNumber);
    deduped.push(r);
  }

  // SKU ownership check.
  const skus = deduped.map((r) => r.sku);
  const existing =
    skus.length > 0
      ? await prisma.product.findMany({
          where: { sku: { in: skus } },
          select: { sku: true, supplierId: true },
        })
      : [];
  const owners = new Map(existing.map((p) => [p.sku, p.supplierId]));
  const toWrite: (CanonicalRow & { exists: boolean })[] = [];
  for (const r of deduped) {
    const owner = owners.get(r.sku);
    if (owner && owner !== supplierId) {
      rowErrors.push({
        rowNumber: r.rowNumber,
        error: "SKU already listed by another supplier",
      });
      continue;
    }
    toWrite.push({ ...r, exists: !!owner });
  }

  let createdCount = 0;
  let updatedCount = 0;
  let committedBatches = 0;
  let failedAtBatch: number | null = null;
  let batchError: string | null = null;
  const partialResults: { rowNumber: number; error: string }[] = [];
  const totalBatches = Math.ceil(toWrite.length / COMMIT_BATCH_SIZE);

  for (let b = 0; b < totalBatches; b++) {
    const slice = toWrite.slice(
      b * COMMIT_BATCH_SIZE,
      (b + 1) * COMMIT_BATCH_SIZE
    );
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        let created = 0;
        let updated = 0;
        for (const r of slice) {
          if (r.exists) {
            try {
              await tx.product.update({
                where: { sku: r.sku, supplierId },
                data: {
                  name: r.name,
                  category: r.category,
                  manufacturer: r.manufacturer,
                  icon: r.icon,
                  imageUrl: r.imageUrl || null,
                  priceCents: r.priceCents,
                  unit: r.unit,
                  etaDays: r.etaDays,
                  stock: r.stock,
                  quoteOnly: r.quoteOnly,
                  description: r.description || undefined,
                },
              });
              updated++;
            } catch (e) {
              if (
                e instanceof Prisma.PrismaClientKnownRequestError &&
                e.code === "P2025"
              ) {
                partialResults.push({
                  rowNumber: r.rowNumber,
                  error: "SKU is no longer yours; another supplier owns it",
                });
              }
              throw e;
            }
          } else {
            try {
              const product = await tx.product.create({
                data: {
                  sku: r.sku,
                  name: r.name,
                  category: r.category,
                  manufacturer: r.manufacturer,
                  icon: r.icon,
                  imageUrl: r.imageUrl || null,
                  priceCents: r.priceCents,
                  unit: r.unit,
                  etaDays: r.etaDays,
                  stock: r.stock,
                  quoteOnly: r.quoteOnly,
                  description:
                    r.description || `${r.name} supplied by ${supplierName}.`,
                  specs: {},
                  supplierId,
                  active: true,
                },
              });
              if (r.imageUrl) {
                await tx.productImage.create({
                  data: {
                    productId: product.id,
                    url: r.imageUrl,
                    ordinal: 0,
                  },
                });
              }
              created++;
            } catch (e) {
              if (
                e instanceof Prisma.PrismaClientKnownRequestError &&
                e.code === "P2002"
              ) {
                partialResults.push({
                  rowNumber: r.rowNumber,
                  error:
                    "SKU was claimed by another supplier before this row could insert",
                });
              }
              throw e;
            }
          }
        }
        return { created, updated };
      });
      createdCount += outcome.created;
      updatedCount += outcome.updated;
      committedBatches++;
    } catch (e) {
      failedAtBatch = b + 1;
      batchError =
        e instanceof Prisma.PrismaClientKnownRequestError
          ? `${e.code}: ${e.message.split("\n")[0]}`
          : (e as { message?: string }).message || "Batch failed";
      break;
    }
  }

  return {
    ok: failedAtBatch === null,
    counts: {
      total: rows.length,
      created: createdCount,
      updated: updatedCount,
      invalid: rowErrors.length,
    },
    committedBatches,
    totalBatches,
    failedAtBatch,
    batchError,
    partialResults,
    rowErrors,
  };
}

// ---------------------------------------------------------------------------
// POST handler. Body shape (legacy + new):
//   { action: "parse",  raw|fileBase64, kind: "csv"|"tsv"|"xlsx" }
//   { action: "chat",   mapping, filters, headers, sampleRows, userMessage }
//   { action: "commit", mapping, filters, raw|fileBase64, kind }
// Legacy body: { csv, commit? } still works for the existing
// CatalogCsvImport component.
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "").toLowerCase();

  // ---- LEGACY PATH (existing CatalogCsvImport component) -----------------
  if (!action && typeof body.csv === "string") {
    return legacyImportHandler(body);
  }

  if (action === "parse") return parseAction(body);
  if (action === "chat") return chatAction(body);
  if (action === "commit") return commitAction(body);

  return NextResponse.json(
    { error: "Unknown action. Use parse, chat, or commit." },
    { status: 400 }
  );
}

// ---------------------------------------------------------------------------
// parseAction
// ---------------------------------------------------------------------------
async function parseAction(body: {
  raw?: string;
  fileBase64?: string;
  kind?: string;
}) {
  const auth = await authorize("parse");
  if ("err" in auth) return auth.err;

  let parsed: ParsedInput;
  try {
    parsed = parseInput(body);
  } catch (e) {
    const msg = (e as { message?: string }).message || "Could not parse input.";
    return NextResponse.json(
      { error: msg },
      { status: msg.includes("too large") ? 413 : 400 }
    );
  }
  if (parsed.headers.length === 0) {
    return NextResponse.json(
      { error: "No header row found. The first row must contain column names." },
      { status: 400 }
    );
  }
  const inferredMapping = inferMapping(parsed.headers);
  const sampleRows = parsed.rows.slice(0, SAMPLE_ROW_CAP);
  return NextResponse.json({
    ok: true,
    delimiter: parsed.delimiter,
    headers: parsed.headers,
    totalRows: parsed.rows.length,
    sampleRows,
    inferredMapping,
    inferredFilters: { skipRowIf: "empty" } as ImportFilters,
  });
}

// ---------------------------------------------------------------------------
// chatAction. Streams the AI reply as plain text. The client extracts the
// final ```json``` block to swap the proposed mapping in.
// ---------------------------------------------------------------------------
async function chatAction(body: {
  mapping?: ImportMapping;
  filters?: ImportFilters;
  headers?: string[];
  sampleRows?: Record<string, string>[];
  userMessage?: string;
}) {
  if (!isImportAIEnabled()) {
    return NextResponse.json(
      { error: "AI assistant is not configured" },
      { status: 503 }
    );
  }
  const auth = await authorize("chat");
  if ("err" in auth) return auth.err;
  const { ctx, user } = auth;

  const userMessage = String(body.userMessage || "").trim();
  if (!userMessage) {
    return NextResponse.json(
      { error: "userMessage is required." },
      { status: 400 }
    );
  }
  if (userMessage.length > MAX_IMPORT_USER_MESSAGE_CHARS) {
    return NextResponse.json(
      {
        error: `Message is too long, keep it under ${MAX_IMPORT_USER_MESSAGE_CHARS} characters.`,
      },
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();
  const supplierId = ctx.supplier.id;
  const supplierName = ctx.supplier.name;
  const userId = user.id;
  const userEmail = user.email;
  const questionHash = crypto
    .createHash("sha256")
    .update(userMessage)
    .digest("hex");

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const iter = streamMappingHelp({
          supplierContext: { id: supplierId, name: supplierName },
          currentMapping: body.mapping || [],
          currentFilters: body.filters || {},
          headers: body.headers || [],
          sampleRows: body.sampleRows || [],
          userMessage,
        });
        for await (const chunk of iter) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
        await writeAuditLog({
          actor: { id: userId, email: userEmail },
          action: "IMPORT_AI_ASKED",
          targetType: "Supplier",
          targetId: supplierId,
          summary: `Import-assistant question (${userMessage.length} chars)`,
          metadata: { questionHash },
        });
      } catch (err) {
        captureError(err, { subsystem: "import-ai" });
        try {
          controller.enqueue(
            encoder.encode(
              "\n\n[Sorry, the assistant hit an error. Try again in a moment.]"
            )
          );
        } catch {
          /* stream already closed */
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

// ---------------------------------------------------------------------------
// commitAction
// ---------------------------------------------------------------------------
async function commitAction(body: {
  mapping?: ImportMapping;
  filters?: ImportFilters;
  raw?: string;
  fileBase64?: string;
  kind?: string;
}) {
  const auth = await authorize("commit");
  if ("err" in auth) return auth.err;
  const { ctx, user } = auth;

  if (!Array.isArray(body.mapping)) {
    return NextResponse.json(
      { error: "Mapping is required." },
      { status: 400 }
    );
  }

  let parsed: ParsedInput;
  try {
    parsed = parseInput(body);
  } catch (e) {
    const msg = (e as { message?: string }).message || "Could not parse input.";
    return NextResponse.json(
      { error: msg },
      { status: msg.includes("too large") ? 413 : 400 }
    );
  }

  const canonical = applyMapping(
    parsed.rows,
    body.mapping,
    body.filters || {}
  );
  const result = await commitRows(
    canonical,
    ctx.supplier.id,
    ctx.supplier.name
  );

  // Audit log.
  const mappingHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(body.mapping))
    .digest("hex")
    .slice(0, 16);
  const filterHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(body.filters || {}))
    .digest("hex")
    .slice(0, 16);
  await writeAuditLog({
    actor: { id: user.id, email: user.email },
    action: "CATALOG_IMPORT_COMMITTED",
    targetType: "Supplier",
    targetId: ctx.supplier.id,
    summary: `AI import committed: ${result.counts.created} new + ${result.counts.updated} updated`,
    metadata: {
      rowCount: result.counts.total,
      mappingHash,
      filterHash,
      created: result.counts.created,
      updated: result.counts.updated,
      invalid: result.counts.invalid,
      committedBatches: result.committedBatches,
      totalBatches: result.totalBatches,
      failedAtBatch: result.failedAtBatch,
    },
  });

  return NextResponse.json(result);
}

// ---------------------------------------------------------------------------
// Legacy path. Preserves the exact behavior the existing CatalogCsvImport
// component depends on. Inlined rather than refactored so the surface
// stays bit-identical: same response shape, same error codes, same batch
// math. The new AI flow uses commitAction above.
// ---------------------------------------------------------------------------
import { dollarsToCents } from "@/lib/money";
import { ICON_KEYS } from "@/components/PartIcon";

type LegacyParsedRow = {
  rowNumber: number;
  sku: string;
  name: string;
  category: string;
  manufacturer: string;
  icon: string;
  price: number;
  unit: string;
  etaDays: number;
  stock: number;
  description: string;
  imageUrl: string;
  quoteOnly: boolean;
  error: string | null;
  exists: boolean;
};

function legacyParseBool(s: string): boolean {
  const t = s.trim().toLowerCase();
  return (
    t === "true" ||
    t === "1" ||
    t === "yes" ||
    t === "y" ||
    t === "quote" ||
    t === "quote only" ||
    t === "quote-only"
  );
}

function legacyNormalizeRow(
  raw: Record<string, string>,
  rowNumber: number
): LegacyParsedRow {
  const sku = String(raw.sku || raw.SKU || raw["Part Number"] || "")
    .trim()
    .toUpperCase();
  const name = (raw.name || raw.Name || raw["Part Name"] || "").trim();
  const category = (raw.category || raw.Category || "").trim();
  const manufacturer = (
    raw.manufacturer ||
    raw.Manufacturer ||
    raw.brand ||
    ""
  ).trim();
  const iconRaw = (raw.icon || raw.Icon || "").trim().toLowerCase();
  const icon = ICON_KEYS.includes(iconRaw) ? iconRaw : "gear";
  const priceStr = (raw.price || raw.Price || raw.priceUSD || "").replace(
    /[$,\s]/g,
    ""
  );
  const price = Number(priceStr);
  const unit = (raw.unit || raw.Unit || "each").trim() || "each";
  const etaDays = Math.max(
    1,
    Math.floor(
      Number(raw.etaDays || raw["Lead Time"] || raw["ETA Days"] || "3") || 3
    )
  );
  const stock = Math.max(0, Math.floor(Number(raw.stock || raw.Stock || "0") || 0));
  const description = (raw.description || raw.Description || "").trim();
  const imageUrl = (raw.imageUrl || raw.image || raw.photo || "").trim();
  const quoteOnlyRaw = (
    raw.quoteOnly ||
    raw["Quote Only"] ||
    raw.quote ||
    ""
  ).trim();
  const quoteOnly = quoteOnlyRaw ? legacyParseBool(quoteOnlyRaw) : price >= 3000;

  let error: string | null = null;
  if (!sku) error = "Missing SKU";
  else if (!name) error = "Missing Name";
  else if (!category) error = "Missing Category";
  else if (!manufacturer) error = "Missing Manufacturer";
  else if (!(price > 0)) error = "Price must be > 0";

  return {
    rowNumber,
    sku,
    name,
    category,
    manufacturer,
    icon,
    price,
    unit,
    etaDays,
    stock,
    description,
    imageUrl,
    quoteOnly,
    error,
    exists: false,
  };
}

async function legacyImportHandler(body: { csv?: string; commit?: boolean }) {
  const auth = await authorize("commit");
  if ("err" in auth) return auth.err;
  const { ctx } = auth;
  const supplier = ctx.supplier;

  const csv = String(body.csv || "");
  const commit = Boolean(body.commit);
  if (!csv.trim()) {
    return NextResponse.json(
      { error: "Paste CSV content with a header row." },
      { status: 400 }
    );
  }
  if (Buffer.byteLength(csv, "utf8") > MAX_RAW_BYTES) {
    return NextResponse.json(
      { error: "CSV too large. Maximum 2 MB. Split into smaller files." },
      { status: 413 }
    );
  }
  const raw = parseCsvWithHeader(csv);
  // parseCsv used internally; keep parseCsv import alive for tree-shaking
  // assumptions in the IDE.
  void parseCsv;
  if (raw.length === 0) {
    return NextResponse.json(
      { error: "No data rows found below the header." },
      { status: 400 }
    );
  }
  const rows = raw.map((r, i) => legacyNormalizeRow(r, i + 2));
  const seen = new Map<string, number>();
  for (const r of rows) {
    if (!r.sku || r.error) continue;
    if (seen.has(r.sku)) {
      r.error = `Duplicate SKU in this file (also row ${seen.get(r.sku)})`;
    } else {
      seen.set(r.sku, r.rowNumber);
    }
  }
  const skus = rows.map((r) => r.sku).filter(Boolean);
  if (skus.length > 0) {
    const existing = await prisma.product.findMany({
      where: { sku: { in: skus } },
      select: { sku: true, supplierId: true },
    });
    const map = new Map(existing.map((p) => [p.sku, p.supplierId]));
    for (const r of rows) {
      if (!r.sku || r.error) continue;
      const owner = map.get(r.sku);
      if (owner) {
        if (owner !== supplier.id) {
          r.error = "SKU already listed by another supplier";
        } else {
          r.exists = true;
        }
      }
    }
  }
  const valid = rows.filter((r) => !r.error);
  const invalid = rows.filter((r) => r.error);
  const created = valid.filter((r) => !r.exists).length;
  const updated = valid.filter((r) => r.exists).length;
  if (!commit) {
    return NextResponse.json({
      ok: true,
      preview: true,
      counts: {
        total: rows.length,
        valid: valid.length,
        invalid: invalid.length,
        created,
        updated,
      },
      rows,
    });
  }
  let createdCount = 0;
  let updatedCount = 0;
  let committedBatches = 0;
  let failedAtBatch: number | null = null;
  let batchError: string | null = null;
  const partialResults: { rowNumber: number; error: string }[] = [];
  const totalBatches = Math.ceil(valid.length / COMMIT_BATCH_SIZE);
  for (let b = 0; b < totalBatches; b++) {
    const slice = valid.slice(
      b * COMMIT_BATCH_SIZE,
      (b + 1) * COMMIT_BATCH_SIZE
    );
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        let cr = 0;
        let up = 0;
        for (const r of slice) {
          const priceCents = dollarsToCents(r.price);
          if (r.exists) {
            try {
              await tx.product.update({
                where: { sku: r.sku, supplierId: supplier.id },
                data: {
                  name: r.name,
                  category: r.category,
                  manufacturer: r.manufacturer,
                  icon: r.icon,
                  imageUrl: r.imageUrl || null,
                  priceCents,
                  unit: r.unit,
                  etaDays: r.etaDays,
                  stock: r.stock,
                  quoteOnly: r.quoteOnly,
                  description: r.description || undefined,
                },
              });
              up++;
            } catch (e) {
              if (
                e instanceof Prisma.PrismaClientKnownRequestError &&
                e.code === "P2025"
              ) {
                partialResults.push({
                  rowNumber: r.rowNumber,
                  error: "SKU is no longer yours; another supplier owns it",
                });
              }
              throw e;
            }
          } else {
            try {
              const product = await tx.product.create({
                data: {
                  sku: r.sku,
                  name: r.name,
                  category: r.category,
                  manufacturer: r.manufacturer,
                  icon: r.icon,
                  imageUrl: r.imageUrl || null,
                  priceCents,
                  unit: r.unit,
                  etaDays: r.etaDays,
                  stock: r.stock,
                  quoteOnly: r.quoteOnly,
                  description:
                    r.description || `${r.name} supplied by ${supplier.name}.`,
                  specs: {},
                  supplierId: supplier.id,
                  active: true,
                },
              });
              if (r.imageUrl) {
                await tx.productImage.create({
                  data: {
                    productId: product.id,
                    url: r.imageUrl,
                    ordinal: 0,
                  },
                });
              }
              cr++;
            } catch (e) {
              if (
                e instanceof Prisma.PrismaClientKnownRequestError &&
                e.code === "P2002"
              ) {
                partialResults.push({
                  rowNumber: r.rowNumber,
                  error:
                    "SKU was claimed by another supplier before this row could insert",
                });
              }
              throw e;
            }
          }
        }
        return { created: cr, updated: up };
      });
      createdCount += outcome.created;
      updatedCount += outcome.updated;
      committedBatches++;
    } catch (e) {
      failedAtBatch = b + 1;
      batchError =
        e instanceof Prisma.PrismaClientKnownRequestError
          ? `${e.code}: ${e.message.split("\n")[0]}`
          : (e as { message?: string }).message || "Batch failed";
      const firstRow = slice[0]?.rowNumber ?? null;
      const lastRow = slice[slice.length - 1]?.rowNumber ?? null;
      if (firstRow !== null && lastRow !== null) {
        partialResults.push({
          rowNumber: firstRow,
          error: `Batch ${b + 1} (rows ${firstRow} to ${lastRow}) rolled back: ${batchError}`,
        });
      }
      break;
    }
  }
  return NextResponse.json({
    ok: failedAtBatch === null,
    preview: false,
    counts: {
      total: rows.length,
      created: createdCount,
      updated: updatedCount,
      invalid: invalid.length,
    },
    committedBatches,
    totalBatches,
    failedAtBatch,
    batchError,
    partialResults,
    rows,
  });
}
