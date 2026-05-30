import { NextResponse } from "next/server";
import crypto from "crypto";
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
 * PLH-3s B1: draft a customer-ready markdown invoice from an existing
 * Order. Visible to the order's supplier members with canSendMessages
 * permission, plus any admin. Streams Sonnet 4.6 tokens.
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
  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required." }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { product: { include: { supplier: true } } } },
      supplierSlots: {
        include: { supplier: { select: { id: true, name: true } } },
      },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const isAdmin = user.role === "ADMIN";
  let isAllowedSupplier = false;
  if (!isAdmin && user.role === "SUPPLIER") {
    const supplierIds = Array.from(
      new Set(order.items.map((it) => it.product.supplierId))
    );
    for (const sid of supplierIds) {
      const access = await userHasAccessToSupplier(user.id, sid);
      if (access.ok && canSendMessages(access.role)) {
        isAllowedSupplier = true;
        break;
      }
    }
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

  const dataContext = {
    order: {
      reference: order.reference,
      createdAt: order.createdAt.toISOString(),
      paidAt: order.paidAt ? order.paidAt.toISOString() : null,
      status: order.status,
      paymentMethod: order.paymentMethod,
      shipTo: order.shipTo,
      buyer: {
        name: order.buyerName,
        email: order.buyerEmail,
        company: order.buyerCompanyName,
      },
      totals: {
        subtotal: formatCents(order.subtotalCents),
        freight: formatCents(order.freightCents),
        fee: formatCents(order.feeCents),
        tax: formatCents(order.taxCents),
        total: formatCents(order.totalCents),
      },
      freightCarrier: order.freightCarrier,
      freightService: order.freightService,
    },
    items: order.items.map((it) => ({
      name: it.nameSnapshot,
      sku: it.skuSnapshot,
      supplier: it.supplierName,
      qty: it.qty,
      unitPrice: formatCents(it.unitPriceCents),
      lineTotal: formatCents(it.unitPriceCents * it.qty),
    })),
    suppliers: order.supplierSlots.map((s) => ({
      name: s.supplier?.name,
      subtotal: formatCents(s.subtotalCents),
      freight: formatCents(s.freightCents),
      fee: formatCents(s.feeCents),
    })),
  };

  const SYSTEM_PROMPT =
    "You are an AI assistant for PartsPort, a B2B industrial parts marketplace. Draft a clean, professional customer-ready invoice in Markdown for the given order. Include: header with the order reference and date, bill-to block, ship-to block, an itemized table (SKU, description, supplier, qty, unit price, line total), totals breakdown (subtotal, freight, platform fee, tax, total), and a short payment-status line. Use plain Markdown only. No em dashes. No emojis. Do not invent numbers or fields not present in the data.";

  const questionHash = crypto
    .createHash("sha256")
    .update(orderId)
    .digest("hex");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const client = new Anthropic({ timeout: 30000, maxRetries: 1 });
        const streamRes = client.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 1500,
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
            {
              type: "text",
              text: `Order data (JSON):\n${JSON.stringify(dataContext)}`,
            },
          ],
          messages: [
            {
              role: "user",
              content:
                "Draft the invoice in Markdown using the order data above.",
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
          action: "AI_DRAFT_INVOICE",
          targetType: "Order",
          targetId: order.id,
          summary: `Drafted AI invoice for order ${order.reference}`,
          metadata: {
            orderHash: questionHash,
            tokensUsed: { input: inputTokens, output: outputTokens },
          },
        });
      } catch (err) {
        captureError(err, { subsystem: "ai-draft-invoice" });
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
