import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveSupplierContext } from "@/lib/supplier-access";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";
import { formatCents } from "@/lib/money";

export const runtime = "nodejs";

function isEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * PLH-3s B2: streams a short paragraph summary plus the top three RFQs
 * ranked by urgency for the calling supplier.
 */
export async function POST() {
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
  const ctx = await getActiveSupplierContext(user);
  if (!ctx) {
    return NextResponse.json({ error: "No active supplier." }, { status: 403 });
  }
  const supplierId = ctx.supplier.id;

  const rl = await rateLimit("ai-assistant", `supplier:${supplierId}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many AI requests, slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      }
    );
  }

  const openQuotes = await prisma.quoteRequest.findMany({
    where: {
      status: "OPEN",
      product: { supplierId },
    },
    include: {
      product: {
        select: {
          name: true,
          sku: true,
          manufacturer: true,
          priceCents: true,
          stock: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  const now = Date.now();
  const rfqs = openQuotes.map((q) => ({
    reference: q.reference,
    productName: q.product.name,
    sku: q.product.sku,
    manufacturer: q.product.manufacturer,
    qty: q.qty,
    catalogPrice: formatCents(q.product.priceCents),
    inStock: q.product.stock,
    buyerEmail: q.buyerEmail,
    buyerName: q.buyerName,
    message: q.message ?? "",
    ageDays: Math.floor((now - q.createdAt.getTime()) / 86400000),
    quoteExpiresAt: q.quoteExpiresAt ? q.quoteExpiresAt.toISOString() : null,
  }));

  const SYSTEM_PROMPT =
    "You are an AI assistant for a supplier on PartsPort, a B2B industrial parts marketplace. Given the calling supplier's open RFQs (Request For Quote), write a short paragraph summary (2-4 sentences) of what is on their plate, then list the top three RFQs ranked by urgency. Urgency is a function of RFQ age, expiry, buyer signals in the message, and quantity. Use Markdown. For each ranked RFQ include the reference, product, qty, buyer, age in days, and one short sentence on why it ranks. No em dashes. No emojis. If there are fewer than three open RFQs, rank what exists. If there are none, say so.";

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const client = new Anthropic({ timeout: 30000, maxRetries: 1 });
        const streamRes = client.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
            {
              type: "text",
              text: `Open RFQs (JSON, total ${rfqs.length}):\n${JSON.stringify(rfqs)}`,
            },
          ],
          messages: [
            {
              role: "user",
              content: "Summarize and rank my open RFQs.",
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
          action: "AI_SUMMARIZE_RFQS",
          targetType: "Supplier",
          targetId: supplierId,
          summary: `Summarized ${rfqs.length} open RFQs`,
          metadata: {
            rfqCount: rfqs.length,
            tokensUsed: { input: inputTokens, output: outputTokens },
          },
        });
      } catch (err) {
        captureError(err, { subsystem: "ai-summarize-rfqs" });
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
