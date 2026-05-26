import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  cleanupCatalog,
  isCatalogAIEnabled,
  rowsToCsv,
} from "@/lib/catalog-import-ai";
import { canEditCatalog, getActiveSupplierContext } from "@/lib/supplier-access";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PLH-2 Phase 4a (A4): same 2 MB cap as catalog-import. Each call here
// also forwards to Anthropic, so oversized input is doubly bad.
const MAX_CSV_BYTES = 2 * 1024 * 1024;

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
  // PLH-2 Phase 4a (A3): two-bucket rate limit. The generic bucket
  // catches the broad case (any supplier-side mutating endpoint); the
  // catalog-cleanup bucket caps Anthropic-cost calls at 10/hour/supplier.
  const rlGeneric = await rateLimit("generic", `supplier:${user.id}`);
  if (!rlGeneric.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a moment." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rlGeneric.retryAfterMs / 1000)) },
      }
    );
  }
  const rlAI = await rateLimit("catalog-cleanup", `supplier:${user.id}`);
  if (!rlAI.allowed) {
    return NextResponse.json(
      {
        error:
          "AI cleanup is capped at 10 per hour per supplier. Try again later.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rlAI.retryAfterMs / 1000)) },
      }
    );
  }
  if (!isCatalogAIEnabled()) {
    return NextResponse.json(
      {
        error:
          "AI cleanup is not configured on this environment. Set ANTHROPIC_API_KEY in Vercel.",
      },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const text = String(body.text || "");
  if (!text.trim()) {
    return NextResponse.json(
      { error: "Paste the supplier's catalog text or table to clean up." },
      { status: 400 }
    );
  }
  if (Buffer.byteLength(text, "utf8") > MAX_CSV_BYTES) {
    return NextResponse.json(
      { error: "CSV too large. Maximum 2 MB. Split into smaller files." },
      { status: 413 }
    );
  }

  try {
    const rows = await cleanupCatalog(text);
    const csv = rowsToCsv(rows);
    return NextResponse.json({
      ok: true,
      csv,
      rows,
      counts: {
        total: rows.length,
        lowConfidence: rows.filter((r) => r.confidence === "low").length,
        flagged: rows.filter((r) => r.notes && r.notes.trim().length > 0).length,
      },
    });
  } catch (err) {
    console.error("[ai-cleanup] failed:", err);
    return NextResponse.json(
      {
        error:
          (err as { message?: string }).message ||
          "Could not clean up the input. Try a smaller batch or simpler format.",
      },
      { status: 502 }
    );
  }
}
