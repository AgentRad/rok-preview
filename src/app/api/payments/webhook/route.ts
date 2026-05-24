import { NextResponse } from "next/server";
import { getProvider } from "@/lib/payments";
import { markOrderPaid } from "@/lib/order-utils";

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
    console.error("[payments] webhook signature failed:", err);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (event && event.type === "session.completed" && event.orderId) {
    await markOrderPaid(event.orderId, provider.name, event.sessionId);
  }
  return NextResponse.json({ received: true });
}
