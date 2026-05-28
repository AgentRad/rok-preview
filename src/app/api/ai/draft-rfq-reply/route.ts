import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  userHasAccessToSupplier,
  canSendMessages,
} from "@/lib/supplier-access";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";
import { formatCents } from "@/lib/money";

export const runtime = "nodejs";

function isEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * PLH-3s B3: draft a supplier reply to an RFQ. Streams a brief professional
 * message that mentions specs, may suggest a price range when comparable
 * filled orders exist for the same product on the same supplier, and
 * NEVER commits to a price.
 */
export async function POST(req: Request) {
  if (!isEnabled()) {
    return NextResponse.json(
      { error: "AI assistant is not configured" },
      { status: 503 }
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const quoteId = typeof body.quoteId === "string" ? body.quoteId : "";
  if (!quoteId) {
    return NextResponse.json({ error: "quoteId is required." }, { status: 400 });
  }

  const quote = await prisma.quoteRequest.findUnique({
    where: { id: quoteId },
    include: {
      product: { include: { supplier: true } },
    },
  });
  if (!quote) {
    return NextResponse.json({ error: "Quote not found." }, { status: 404 });
  }

  const isAdmin = user.role === "ADMIN";
  let isAllowedSupplier = false;
  if (!isAdmin && user.role === "SUPPLIER") {
    const access = await userHasAccessToSupplier(
      user.id,
      quote.product.supplierId
    );
    isAllowedSupplier = access.ok && canSendMessages(access.role);
  }
  if (!isAdmin && !isAllowedSupplier) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const rl = await rateLimit("ai-assistant", `user:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many AI requests, slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      }
    );
  }

  // Pull recent filled orders for THIS product to anchor an honest price
  // range. The prompt uses this only as a "comparable" hint; the AI is
  // told not to commit.
  const comparableItems = await prisma.orderItem.findMany({
    where: {
      productId: quote.productId,
      order: {
        status: { in: ["PAID", "FULFILLED"] },
      },
    },
    select: {
      qty: true,
      unitPriceCents: true,
      order: { select: { createdAt: true } },
    },
    take: 25,
    orderBy: { id: "desc" },
  });

  const prices = comparableItems
    .map((it) => it.unitPriceCents)
    .filter((c) => c > 0);
  let comparablePrice: {
    count: number;
    minCents: number;
    maxCents: number;
    medianCents: number;
  } | null = null;
  if (prices.length > 0) {
    const sorted = [...prices].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    comparablePrice = {
      count: sorted.length,
      minCents: sorted[0],
      maxCents: sorted[sorted.length - 1],
      medianCents: median,
    };
  }

  const dataContext = {
    rfq: {
      reference: quote.reference,
      qty: quote.qty,
      buyerName: quote.buyerName,
      buyerEmail: quote.buyerEmail,
      message: quote.message ?? "",
      ageDays: Math.floor(
        (Date.now() - quote.createdAt.getTime()) / 86400000
      ),
      status: quote.status,
    },
    product: {
      name: quote.product.name,
      sku: quote.product.sku,
      manufacturer: quote.product.manufacturer,
      catalogPrice: formatCents(quote.product.priceCents),
      inStock: quote.product.stock,
      unit: quote.product.unit,
      description: quote.product.description,
    },
    supplier: {
      name: quote.product.supplier.name,
    },
    comparablePrice: comparablePrice
      ? {
          count: comparablePrice.count,
          min: formatCents(comparablePrice.minCents),
          median: formatCents(comparablePrice.medianCents),
          max: formatCents(comparablePrice.maxCents),
        }
      : null,
  };

  const SYSTEM_PROMPT =
    "You are an AI assistant drafting a SUPPLIER reply to a buyer's RFQ on PartsPort, a B2B industrial parts marketplace. Write a brief, professional message (3-6 sentences). Mention the specific product name, SKU, and quantity the buyer asked about. Acknowledge their note if they left one. If comparable filled orders exist, you MAY mention a price range as historical context, framed as 'recent comparable orders ranged from X to Y'. NEVER commit to a price, never quote a final price, never say 'we can do it for'. Close with a clear next step (the supplier will follow up with a formal quote shortly, or asks a clarifying question). No greeting boilerplate. No em dashes. No emojis. Plain text only, no Markdown. Sign off with the supplier name only.";

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const client = new Anthropic({ timeout: 30000, maxRetries: 1 });
        const streamRes = client.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 700,
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
            {
              type: "text",
              text: `RFQ data (JSON):\n${JSON.stringify(dataContext)}`,
            },
          ],
          messages: [
            {
              role: "user",
              content: "Draft a supplier reply to this RFQ.",
            },
          ],
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

        await writeAuditLog({
          actor: { id: user.id, email: user.email },
          action: "AI_DRAFT_RFQ_REPLY",
          targetType: "QuoteRequest",
          targetId: quote.id,
          summary: `Drafted AI reply for RFQ ${quote.reference}`,
          metadata: {
            comparableCount: comparablePrice?.count ?? 0,
            tokensUsed: { input: inputTokens, output: outputTokens },
          },
        });
      } catch (err) {
        captureError(err, { subsystem: "ai-draft-rfq-reply" });
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
