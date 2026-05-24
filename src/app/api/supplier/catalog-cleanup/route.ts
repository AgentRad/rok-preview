import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  cleanupCatalog,
  isCatalogAIEnabled,
  rowsToCsv,
} from "@/lib/catalog-import-ai";
import { canEditCatalog, getSupplierContextForUser } from "@/lib/supplier-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "SUPPLIER" && user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  if (user.role === "SUPPLIER") {
    const ctx = await getSupplierContextForUser(user.id);
    if (!ctx) {
      return NextResponse.json(
        { error: "No supplier profile linked to this account." },
        { status: 400 }
      );
    }
    if (!canEditCatalog(ctx.role)) {
      return NextResponse.json(
        { error: "Your role doesn't allow editing the catalog." },
        { status: 403 }
      );
    }
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
