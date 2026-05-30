import "server-only";

const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || "";
const BASE =
  process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

export function isPayPalConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

async function accessToken(): Promise<string> {
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new Error("PayPal auth failed");
  const data = await res.json();
  return data.access_token as string;
}

export async function createPayPalOrder(
  totalDollars: number,
  reference: string
): Promise<string> {
  const token = await accessToken();
  const res = await fetch(`${BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: reference,
          description: `PartsPort order ${reference}`,
          amount: { currency_code: "USD", value: totalDollars.toFixed(2) },
        },
      ],
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("PayPal order creation failed");
  const data = await res.json();
  return data.id as string;
}

export async function capturePayPalOrder(
  paypalOrderId: string
): Promise<boolean> {
  const token = await accessToken();
  const res = await fetch(
    `${BASE}/v2/checkout/orders/${paypalOrderId}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    }
  );
  if (!res.ok) return false;
  const data = await res.json();
  return data.status === "COMPLETED";
}
