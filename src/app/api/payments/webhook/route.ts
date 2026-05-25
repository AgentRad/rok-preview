import { NextResponse } from "next/server";
import { getProvider } from "@/lib/payments";
import { markOrderPaid } from "@/lib/order-utils";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";
// Webhook signatures verify against the raw body. Next.js gives us the raw
// stream here as long as we read it with req.text().
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const provider = getProvider();
  if (!provider) {
    return NextResponse.json({ error: "Payments not configured." }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature") || "";
  const body = await req.text();

  let event: Awaited<ReturnType<typeof provider.parseWebhookEvent>>;
  try {
    event = await provider.parseWebhookEvent({ body, signature });
  } catch (err) {
    captureError(err, { subsystem: "payments", op: "webhook-verify" });
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (event && event.type === "session.completed" && event.orderId) {
    await markOrderPaid(event.orderId, provider.name, event.sessionId, {
      taxCents: event.taxCents ?? 0,
      amountTotalCents: event.amountTotalCents,
    });
  }
  return NextResponse.json({ received: true });
}
