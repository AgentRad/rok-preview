import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { dollarsToCents } from "@/lib/money";
import { parseCsvWithHeader } from "@/lib/csv";
import { ICON_KEYS } from "@/components/PartIcon";
import { canEditCatalog, getActiveSupplierContext } from "@/lib/supplier-access";
import { rateLimit } from "@/lib/rate-limit";

// PLH-2 Phase 4a (A4): hard cap on raw CSV size. 2 MB is roughly 20k rows
// of typical supplier catalog data, well above any realistic single import.
// Anything larger is either a misuse or a denial-of-service attempt; the
// component asks the user to split.
const MAX_CSV_BYTES = 2 * 1024 * 1024;
// PLH-2 Phase 4a (A1): chunk row commits into batches so a transaction
// doesn't have to hold thousands of writes open. Each batch is its own
// transaction: previous batches stay committed, the failing batch rolls
// back, the response tells the user exactly where it stopped.
const COMMIT_BATCH_SIZE = 100;

export const runtime = "nodejs";

type ParsedRow = {
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

function parseBool(s: string): boolean {
  const t = s.trim().toLowerCase();
  return t === "true" || t === "1" || t === "yes" || t === "y" || t === "quote" || t === "quote only" || t === "quote-only";
}

function normalizeRow(
  raw: Record<string, string>,
  rowNumber: number
): ParsedRow {
  const sku = String(raw.sku || raw.SKU || raw["Part Number"] || "")
    .trim()
    .toUpperCase();
  const name = (raw.name || raw.Name || raw["Part Name"] || "").trim();
  const category = (raw.category || raw.Category || "").trim();
  const manufacturer = (raw.manufacturer || raw.Manufacturer || raw.brand || "").trim();
  const iconRaw = (raw.icon || raw.Icon || "").trim().toLowerCase();
  const icon = ICON_KEYS.includes(iconRaw) ? iconRaw : "gear";
  const priceStr = (raw.price || raw.Price || raw.priceUSD || "")
    .replace(/[$,\s]/g, "");
  const price = Number(priceStr);
  const unit = (raw.unit || raw.Unit || "each").trim() || "each";
  const etaDays = Math.max(
    1,
    Math.floor(Number(raw.etaDays || raw["Lead Time"] || raw["ETA Days"] || "3") || 3)
  );
  const stock = Math.max(
    0,
    Math.floor(Number(raw.stock || raw.Stock || "0") || 0)
  );
  const description = (raw.description || raw.Description || "").trim();
  const imageUrl = (raw.imageUrl || raw.image || raw.photo || "").trim();
  const quoteOnlyRaw = (raw.quoteOnly || raw["Quote Only"] || raw.quote || "").trim();
  const quoteOnly = quoteOnlyRaw ? parseBool(quoteOnlyRaw) : price >= 3000;

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

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "SUPPLIER" && user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const ctx = await getActiveSupplierContext(user);
  if (!ctx) {
    return NextResponse.json(
      {
        error:
          user.role === "ADMIN"
            ? "Use 'Manage as' on /admin to act as a specific supplier first."
            : "No supplier profile linked to this account.",
      },
      { status: 400 }
    );
  }
  if (!canEditCatalog(ctx.role)) {
    return NextResponse.json(
      { error: "Your role doesn't allow editing the catalog." },
      { status: 403 }
    );
  }
  const supplier = ctx.supplier;

  // PLH-2 Phase 4a (A3): per-supplier rate limit. Bulk import is heavy on
  // the DB; one supplier looping a stuck client shouldn't starve others.
  const rl = await rateLimit("generic", `supplier:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a moment." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      }
    );
  }

  const body = await req.json().catch(() => ({}));
  const csv = String(body.csv || "");
  const commit = Boolean(body.commit);

  if (!csv.trim()) {
    return NextResponse.json(
      { error: "Paste CSV content with a header row." },
      { status: 400 }
    );
  }

  // PLH-2 Phase 4a (A4): reject oversize payloads before we burn parse
  // time and memory on them. Byte length, not character length, so the
  // limit means the same thing for UTF-8 multi-byte rows.
  if (Buffer.byteLength(csv, "utf8") > MAX_CSV_BYTES) {
    return NextResponse.json(
      { error: "CSV too large. Maximum 2 MB. Split into smaller files." },
      { status: 413 }
    );
  }

  const raw = parseCsvWithHeader(csv);
  if (raw.length === 0) {
    return NextResponse.json(
      { error: "No data rows found below the header." },
      { status: 400 }
    );
  }

  const rows = raw.map((r, i) => normalizeRow(r, i + 2));

  // Detect in-file duplicates: same SKU twice.
  const seen = new Map<string, number>();
  for (const r of rows) {
    if (!r.sku || r.error) continue;
    if (seen.has(r.sku)) {
      r.error = `Duplicate SKU in this file (also row ${seen.get(r.sku)})`;
    } else {
      seen.set(r.sku, r.rowNumber);
    }
  }

  // Mark rows whose SKU already exists; those owned by another supplier are
  // a hard error to keep one supplier from overwriting another's listing.
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

  // PLH-2 Phase 4a (A1): bulk writes in batched transactions. Each batch
  // of COMMIT_BATCH_SIZE rows runs inside `prisma.$transaction(async tx =>
  // ...)`: either every write in the batch commits or none do. Previous
  // batches stay committed. The response reports committedBatches and
  // (on partial failure) failedAtBatch so the user sees exactly where it
  // stopped and can re-upload the tail.
  //
  // PLH-2 Phase 4a (A2): TOCTOU on SKU ownership. The pre-flight `findMany`
  // and the `update` below can race against a concurrent import from
  // another supplier. Compound `where: { sku, supplierId }` makes the
  // update a no-op (P2025) when ownership flipped mid-flight rather than
  // silently overwriting another supplier's row. The create path catches
  // P2002 (unique-violation on SKU) and reports it as a row-level error
  // instead of bubbling a 500.
  let createdCount = 0;
  let updatedCount = 0;
  let committedBatches = 0;
  let failedAtBatch: number | null = null;
  let batchError: string | null = null;
  const partialResults: Array<{ rowNumber: number; error: string }> = [];

  const totalBatches = Math.ceil(valid.length / COMMIT_BATCH_SIZE);

  for (let b = 0; b < totalBatches; b++) {
    const slice = valid.slice(
      b * COMMIT_BATCH_SIZE,
      (b + 1) * COMMIT_BATCH_SIZE
    );
    try {
      const batchOutcome = await prisma.$transaction(async (tx) => {
        let created = 0;
        let updated = 0;
        const rowErrors: Array<{ rowNumber: number; error: string }> = [];
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
              updated++;
            } catch (e) {
              if (
                e instanceof Prisma.PrismaClientKnownRequestError &&
                e.code === "P2025"
              ) {
                // Ownership flipped between the preflight read and now.
                // Surface as a row error and roll the batch back so the
                // user can re-check ownership and retry the tail.
                rowErrors.push({
                  rowNumber: r.rowNumber,
                  error: "SKU is no longer yours; another supplier owns it",
                });
                throw e;
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
                  data: { productId: product.id, url: r.imageUrl, position: 0 },
                });
              }
              created++;
            } catch (e) {
              if (
                e instanceof Prisma.PrismaClientKnownRequestError &&
                e.code === "P2002"
              ) {
                rowErrors.push({
                  rowNumber: r.rowNumber,
                  error: "SKU was claimed by another supplier before this row could insert",
                });
                throw e;
              }
              throw e;
            }
          }
        }
        return { created, updated, rowErrors };
      });
      createdCount += batchOutcome.created;
      updatedCount += batchOutcome.updated;
      committedBatches++;
    } catch (e) {
      failedAtBatch = b + 1;
      batchError =
        e instanceof Prisma.PrismaClientKnownRequestError
          ? `${e.code}: ${e.message.split("\n")[0]}`
          : (e as { message?: string }).message || "Batch failed";
      // Surface row-level details collected before the throw, if any. The
      // throw rolled the batch back, so these rows did NOT commit.
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
