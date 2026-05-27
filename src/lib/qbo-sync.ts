import "server-only";
import { prisma } from "./db";
import {
  getOrRefreshCredential,
  intuitBaseUrl,
  refreshAccessToken,
  QBO_PROVIDER,
} from "./qbo-auth";
import { rateLimit } from "./rate-limit";
import { writeAuditLog } from "./audit";
import { captureError } from "./observability";

/**
 * PLH-3i P2: QuickBooks Online sync primitives.
 *
 * Wraps the Intuit v3 REST API for the operations PartsPort needs to
 * push a paid Order out to QBO as a Customer + Invoice pair. Token
 * refresh, rate limiting, error audit, and Sentry capture are all
 * centralized here so callers (markOrderPaid for now; refundOrder +
 * the reconcile cron in later phases) stay clean.
 *
 * Item sync is intentionally out of scope. Every line item references
 * the QBO sandbox default Sales item id "1". When PartsPort needs real
 * per-SKU items in QBO, this is the place to add an ensureItem helper.
 */

const QBO_DEFAULT_ITEM_ID = "1";

type OrderItemLite = {
  nameSnapshot: string;
  skuSnapshot: string;
  unitPriceCents: number;
  qty: number;
};

export type OrderForQboSync = {
  id: string;
  reference: string;
  buyerId: string | null;
  buyerEmail: string;
  buyerName: string;
  shipTo: string;
  subtotalCents: number;
  freightCents: number;
  feeCents: number;
  taxCents: number;
  totalCents: number;
  items: OrderItemLite[];
};

type Credential = {
  id: string;
  provider: string;
  realmId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
};

/**
 * Resolve a usable QBO credential or throw. Centralizes the "feature off"
 * check so callers can `intuitConfigured()` first and skip; once we get
 * here we require a real connected company.
 */
async function requireCredential(): Promise<Credential> {
  const cred = await getOrRefreshCredential(QBO_PROVIDER);
  if (!cred) {
    const err = new Error("QuickBooks Online is not connected.");
    (err as Error & { status?: number }).status = 503;
    throw err;
  }
  return cred as Credential;
}

/**
 * Low-level Intuit fetch. Adds Authorization, JSON Accept, soft rate
 * limit on the per-realm intuit bucket, and a single 401 retry path
 * where we force-refresh the access token and try once more. Errors
 * are wrapped + captured + rethrown.
 */
export async function qboFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  let cred = await requireCredential();
  try {
    await rateLimit("intuit", `realm:${cred.realmId}`);
    const url = `${intuitBaseUrl()}/v3/company/${cred.realmId}${path}`;
    const doFetch = async (token: string) => {
      const headers = new Headers(init.headers || {});
      headers.set("Authorization", `Bearer ${token}`);
      headers.set("Accept", "application/json");
      if (init.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      return fetch(url, { ...init, headers });
    };
    let res = await doFetch(cred.accessToken);
    if (res.status === 401) {
      // Access token may have been invalidated server-side between our
      // refresh check and now. Force a refresh and retry once.
      const fresh = await refreshAccessToken(cred);
      cred = {
        ...cred,
        accessToken: fresh.accessToken,
        refreshToken: fresh.refreshToken,
        expiresAt: new Date(Date.now() + fresh.expiresIn * 1000),
      };
      res = await doFetch(cred.accessToken);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // leave as raw text
      }
      const err = new Error(
        `Intuit ${init.method || "GET"} ${path} failed: ${res.status} ${String(
          typeof parsed === "string" ? parsed : JSON.stringify(parsed)
        ).slice(0, 400)}`
      );
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    return res;
  } catch (err) {
    captureError(err, { subsystem: "qbo-sync", op: "qboFetch", path });
    throw err;
  }
}

type QboQueryResponse<T> = {
  QueryResponse?: { Customer?: T[]; Invoice?: T[]; maxResults?: number };
};

function escapeQboString(s: string): string {
  // Intuit's query language uses single-quoted string literals; the only
  // escape is a doubled single quote.
  return s.replace(/'/g, "''");
}

/**
 * Find-or-create a QBO Customer for a buyer. Persists the resolved id
 * on User.qboCustomerId when a userId is available so future invoices
 * skip the search round-trip.
 */
export async function ensureQboCustomer(args: {
  userId?: string | null;
  buyerEmail: string;
  displayName: string;
  billingAddress?: string | null;
}): Promise<string> {
  // 1. Cached on User?
  if (args.userId) {
    const user = await prisma.user.findUnique({
      where: { id: args.userId },
      select: { qboCustomerId: true },
    });
    if (user?.qboCustomerId) return user.qboCustomerId;
  }

  // 2. Look up by primary email.
  const emailEsc = escapeQboString(args.buyerEmail);
  const queryPath = `/query?query=${encodeURIComponent(
    `SELECT Id FROM Customer WHERE PrimaryEmailAddr='${emailEsc}'`
  )}`;
  const searchRes = await qboFetch(queryPath, { method: "GET" });
  const searchJson = (await searchRes.json()) as QboQueryResponse<{
    Id: string;
  }>;
  const found = searchJson.QueryResponse?.Customer?.[0]?.Id;
  if (found) {
    if (args.userId) {
      await prisma.user.update({
        where: { id: args.userId },
        data: { qboCustomerId: found },
      });
    }
    return found;
  }

  // 3. Create.
  const body: Record<string, unknown> = {
    DisplayName: args.displayName,
    PrimaryEmailAddr: { Address: args.buyerEmail },
  };
  if (args.billingAddress) {
    body.BillAddr = { Line1: args.billingAddress.slice(0, 500) };
  }
  const createRes = await qboFetch("/customer", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const createJson = (await createRes.json()) as {
    Customer?: { Id: string };
  };
  const id = createJson.Customer?.Id;
  if (!id) {
    const err = new Error("Intuit /customer response missing Customer.Id");
    captureError(err, { subsystem: "qbo-sync", op: "ensureQboCustomer" });
    throw err;
  }
  if (args.userId) {
    await prisma.user.update({
      where: { id: args.userId },
      data: { qboCustomerId: id },
    });
  }
  return id;
}

/**
 * Sync a paid Order to QBO as an Invoice. Idempotent on
 * Invoice.qboInvoiceId. Audit-logs success and failure. Failure also
 * captures to Sentry and rethrows; the markOrderPaid after() block
 * swallows so the buyer-facing flow doesn't break on QBO outages.
 */
export async function syncInvoice(
  order: OrderForQboSync
): Promise<{ qboInvoiceId: string; skipped?: boolean }> {
  const invoice = await prisma.invoice.findUnique({
    where: { orderId: order.id },
    select: { id: true, qboInvoiceId: true },
  });
  if (!invoice) {
    throw new Error(
      `syncInvoice: no Invoice row for order ${order.id} (call ensureInvoiceForOrder first)`
    );
  }
  if (invoice.qboInvoiceId) {
    return { qboInvoiceId: invoice.qboInvoiceId, skipped: true };
  }

  try {
    const customerId = await ensureQboCustomer({
      userId: order.buyerId,
      buyerEmail: order.buyerEmail,
      displayName: order.buyerName || order.buyerEmail,
      billingAddress: order.shipTo,
    });

    // Line items. One SalesItemLineDetail per OrderItem. ItemRef.value = "1"
    // is QBO's default Sales item; per-SKU item sync is intentionally out
    // of scope for this round (documented at top of file).
    const itemLines = order.items.map((item) => ({
      DetailType: "SalesItemLineDetail",
      Amount: (item.qty * item.unitPriceCents) / 100,
      Description: `${item.nameSnapshot} (${item.skuSnapshot})`,
      SalesItemLineDetail: {
        ItemRef: { value: QBO_DEFAULT_ITEM_ID },
        Qty: item.qty,
        UnitPrice: item.unitPriceCents / 100,
      },
    }));

    if (order.freightCents > 0) {
      itemLines.push({
        DetailType: "SalesItemLineDetail",
        Amount: order.freightCents / 100,
        Description: "Freight",
        SalesItemLineDetail: {
          ItemRef: { value: QBO_DEFAULT_ITEM_ID },
          Qty: 1,
          UnitPrice: order.freightCents / 100,
        },
      });
    }

    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const payload: Record<string, unknown> = {
      CustomerRef: { value: customerId },
      Line: itemLines,
      DocNumber: order.reference,
      PrivateNote: `PartsPort order ${order.id}`,
      DueDate: dueDate,
    };
    if (order.taxCents > 0) {
      // Snapshotted tax cents from PLH-1. We pass it as an override on
      // TxnTaxDetail so QBO records it without recomputing.
      payload.TxnTaxDetail = { TotalTax: order.taxCents / 100 };
    }

    const res = await qboFetch("/invoice", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { Invoice?: { Id: string } };
    const qboInvoiceId = json.Invoice?.Id;
    if (!qboInvoiceId) {
      throw new Error("Intuit /invoice response missing Invoice.Id");
    }

    const cred = await requireCredential();
    await prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { qboInvoiceId },
      });
    });
    await writeAuditLog({
      actor: { id: "system", email: "system@partsport" },
      action: "QBO_INVOICE_SYNCED",
      targetType: "Order",
      targetId: order.id,
      summary: `Synced invoice ${order.reference} to QBO ${qboInvoiceId}`,
      metadata: {
        orderId: order.id,
        qboInvoiceId,
        realmId: cred.realmId,
      },
    });
    return { qboInvoiceId };
  } catch (err) {
    await writeAuditLog({
      actor: { id: "system", email: "system@partsport" },
      action: "QBO_SYNC_FAILED",
      targetType: "Order",
      targetId: order.id,
      summary: `QBO invoice sync failed for ${order.reference}`,
      metadata: {
        orderId: order.id,
        kind: "invoice",
        error: String(err instanceof Error ? err.message : err).slice(0, 500),
      },
    });
    captureError(err, { subsystem: "qbo-sync", op: "syncInvoice", orderId: order.id });
    throw err;
  }
}
