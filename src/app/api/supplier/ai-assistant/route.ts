import { NextResponse } from "next/server";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveSupplierContext } from "@/lib/supplier-access";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";

const MAX_QUESTION_CHARS = 2000;

/**
 * Whether the supplier-side AI assistant is wired up. Mirrors the search
 * gate. UI uses the GET on this route to decide whether to render the tile.
 */
function isSupplierAIEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Light GET so the dashboard can render a "unavailable" pill when the key
 * is unset without needing a separate config route. Auth-gated to the
 * supplier role, same as the POST.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const ctx = await getActiveSupplierContext(user);
  if (!ctx) {
    return NextResponse.json({ error: "No active supplier." }, { status: 403 });
  }
  return NextResponse.json({ enabled: isSupplierAIEnabled() });
}

/**
 * PLH-2 Phase 2: supplier-facing AI assistant. Streams a Claude reply that
 * answers the supplier's question grounded in their own business metrics.
 * The system prompt is marked with prompt-cache so identical preambles
 * across questions in the same window cost less.
 */
export async function POST(req: Request) {
  if (!isSupplierAIEnabled()) {
    return NextResponse.json(
      { error: "AI assistant is not configured" },
      { status: 503 }
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const ctx = await getActiveSupplierContext(user);
  if (!ctx) {
    return NextResponse.json({ error: "No active supplier." }, { status: 403 });
  }
  const supplierId = ctx.supplier.id;

  const rl = await rateLimit("ai-assistant", `supplier:${supplierId}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many questions, slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      }
    );
  }

  const body = await req.json().catch(() => ({}));
  const rawQuestion = typeof body.question === "string" ? body.question : "";
  const question = rawQuestion.trim();
  if (question.length === 0) {
    return NextResponse.json({ error: "Question is required." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json(
      { error: `Question is too long, keep it under ${MAX_QUESTION_CHARS} characters.` },
      { status: 400 }
    );
  }

  // Pull the supplier's own data context. Last 30 days of orders, current
  // inventory, recent payouts, refund rate (90d), reserve + owed balance.
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    include: { products: true },
  });
  if (!supplier) {
    return NextResponse.json({ error: "Supplier not found." }, { status: 404 });
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const [orders30d, payouts, refunds90d, orders90d, returns90d] = await Promise.all([
    prisma.order.findMany({
      where: {
        createdAt: { gte: thirtyDaysAgo },
        items: { some: { product: { supplierId } } },
        status: { in: ["PAID", "FULFILLED", "REFUNDED"] },
      },
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.payout.findMany({
      where: { supplierId },
      include: { order: { select: { reference: true } } },
      orderBy: [{ createdAt: "desc" }],
      take: 10,
    }),
    prisma.refund.findMany({
      where: {
        createdAt: { gte: ninetyDaysAgo },
        order: { items: { some: { product: { supplierId } } } },
      },
      include: { order: { select: { reference: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.order.count({
      where: {
        createdAt: { gte: ninetyDaysAgo },
        items: { some: { product: { supplierId } } },
        status: { in: ["PAID", "FULFILLED", "REFUNDED"] },
      },
    }),
    prisma.returnRequest.findMany({
      where: {
        createdAt: { gte: ninetyDaysAgo },
        order: { items: { some: { product: { supplierId } } } },
      },
      select: { id: true, status: true, reason: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Build per-SKU sales rollup over the 30-day window (the assistant uses
  // this to answer "which SKUs sold the most" without re-running SQL).
  const skuRollup = new Map<
    string,
    { sku: string; name: string; unitsSold: number; revenueCents: number }
  >();
  let revenue30dCents = 0;
  let avgDaysToShip = 0;
  let shippedCount = 0;
  for (const o of orders30d) {
    for (const it of o.items) {
      if (it.product.supplierId !== supplierId) continue;
      revenue30dCents += it.unitPriceCents * it.qty;
      const row = skuRollup.get(it.skuSnapshot) ?? {
        sku: it.skuSnapshot,
        name: it.nameSnapshot,
        unitsSold: 0,
        revenueCents: 0,
      };
      row.unitsSold += it.qty;
      row.revenueCents += it.unitPriceCents * it.qty;
      skuRollup.set(it.skuSnapshot, row);
    }
    if (o.paidAt && o.shipmentStage === "Shipped" && o.cancelledAt == null) {
      // Rough estimate: time between paidAt and the most recent update on
      // the order. Without a dedicated shippedAt column, the createdAt of
      // the latest payout for the order is a reasonable proxy.
      const payout = payouts.find((p) => p.order.reference === o.reference);
      if (payout) {
        const days =
          (payout.createdAt.getTime() - o.paidAt.getTime()) / (1000 * 60 * 60 * 24);
        if (days >= 0 && days < 60) {
          avgDaysToShip += days;
          shippedCount += 1;
        }
      }
    }
  }
  avgDaysToShip = shippedCount > 0 ? avgDaysToShip / shippedCount : 0;

  const topSkus = [...skuRollup.values()]
    .sort((a, b) => b.unitsSold - a.unitsSold)
    .slice(0, 10);

  const refundedCents90d = refunds90d.reduce((s, r) => s + r.amountCents, 0);
  const refundRate90d = orders90d > 0 ? refunds90d.length / orders90d : 0;

  const inventory = supplier.products
    .filter((p) => p.active)
    .map((p) => ({
      sku: p.sku,
      name: p.name,
      stock: p.stock,
      unit: p.unit,
      priceCents: p.priceCents,
      lowStock: p.stock < 5,
    }));

  const dataContext = {
    supplier: {
      id: supplier.id,
      name: supplier.name,
      reservePercent: supplier.reservePercent,
      reserveBalanceCents: supplier.reserveBalanceCents,
      owedToPlatformCents: supplier.owedToPlatformCents,
      rating: supplier.rating,
      onTimeRate: supplier.onTimeRate,
    },
    windows: {
      now: now.toISOString(),
      last30Days: { start: thirtyDaysAgo.toISOString(), end: now.toISOString() },
      last90Days: { start: ninetyDaysAgo.toISOString(), end: now.toISOString() },
    },
    salesLast30Days: {
      orderCount: orders30d.length,
      revenueCents: revenue30dCents,
      topSkus,
      avgDaysToShip: Number(avgDaysToShip.toFixed(2)),
    },
    inventorySnapshot: inventory,
    recentPayouts: payouts.map((p) => ({
      reference: p.reference,
      orderReference: p.order.reference,
      status: p.status,
      amountCents: p.amountCents,
      reservedCents: p.reservedCents,
      createdAt: p.createdAt.toISOString(),
      paidAt: p.paidAt ? p.paidAt.toISOString() : null,
      note: p.note,
    })),
    refunds90Days: {
      count: refunds90d.length,
      totalCents: refundedCents90d,
      rate: Number(refundRate90d.toFixed(4)),
      totalOrders: orders90d,
      items: refunds90d.slice(0, 10).map((r) => ({
        orderReference: r.order.reference,
        amountCents: r.amountCents,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      })),
    },
    returns90Days: returns90d.map((r) => ({
      status: r.status,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    })),
  };

  const SYSTEM_PROMPT =
    "You are an AI assistant for a supplier on PartsPort, a B2B industrial parts marketplace. Answer questions about THIS SUPPLIER's business data only. The supplier's data context is below. Be concise. If asked something you can't answer from the data, say so.";

  const questionHash = crypto
    .createHash("sha256")
    .update(question)
    .digest("hex");

  // Stream the response back to the client as SSE-ish plain text chunks.
  // The component just appends each chunk to the current assistant message.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const client = new Anthropic({ timeout: 30000, maxRetries: 1 });
        const streamRes = client.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
            {
              type: "text",
              text: `Supplier data context (JSON):\n${JSON.stringify(dataContext)}`,
            },
          ],
          messages: [{ role: "user", content: question }],
        });

        for await (const event of streamRes) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const finalMsg = await streamRes.finalMessage();
        const inputTokens = finalMsg.usage?.input_tokens ?? 0;
        const outputTokens = finalMsg.usage?.output_tokens ?? 0;
        controller.close();

        // Best-effort audit log. We hash the question (don't store raw text)
        // and stash token usage for cost forensics.
        await writeAuditLog({
          actor: { id: user.id, email: user.email },
          action: "SUPPLIER_AI_ASKED",
          targetType: "Supplier",
          targetId: supplier.id,
          summary: `Supplier asked AI assistant (${question.length} chars)`,
          metadata: {
            questionHash,
            tokensUsed: { input: inputTokens, output: outputTokens },
          },
        });
      } catch (err) {
        captureError(err, { subsystem: "supplier-ai-assistant" });
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
