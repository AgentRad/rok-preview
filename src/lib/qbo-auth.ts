import "server-only";
import { prisma } from "./db";
import { captureError } from "./observability";

/**
 * PLH-3i P1: Intuit QuickBooks Online OAuth helpers.
 *
 * Tokens are stored raw in @db.Text. PartsPort has no ENCRYPTION_KEY infra
 * at this round; documented as a known gap. When key infra arrives, swap
 * the read/write paths inside this file and migrate existing rows.
 *
 * Intuit's published rate limit is 500 requests per minute per realm. We
 * register an "intuit" bucket in src/lib/rate-limit.ts; the actual throttle
 * is in-memory at this round (good enough for soft launch traffic).
 */

export const QBO_PROVIDER = "quickbooks_online";

const INTUIT_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const INTUIT_TOKEN_URL =
  "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export function intuitConfigured(): boolean {
  return Boolean(
    process.env.INTUIT_CLIENT_ID && process.env.INTUIT_CLIENT_SECRET
  );
}

export function intuitEnvironment(): "sandbox" | "production" {
  const v = (process.env.INTUIT_ENVIRONMENT || "sandbox").toLowerCase();
  return v === "production" ? "production" : "sandbox";
}

export function intuitBaseUrl(): string {
  return intuitEnvironment() === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

export function intuitOauthBaseUrl(): {
  authorize: string;
  token: string;
} {
  return { authorize: INTUIT_AUTHORIZE_URL, token: INTUIT_TOKEN_URL };
}

export function buildAuthorizeUrl(args: {
  state: string;
  redirectUri: string;
}): string {
  const params = new URLSearchParams({
    client_id: process.env.INTUIT_CLIENT_ID || "",
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: args.redirectUri,
    state: args.state,
  });
  return `${INTUIT_AUTHORIZE_URL}?${params.toString()}`;
}

function basicAuthHeader(): string {
  const clientId = process.env.INTUIT_CLIENT_ID || "";
  const clientSecret = process.env.INTUIT_CLIENT_SECRET || "";
  return (
    "Basic " +
    Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")
  );
}

export type TokenResult = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export async function exchangeCodeForTokens(args: {
  code: string;
  redirectUri: string;
}): Promise<TokenResult> {
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: args.redirectUri,
    });
    const res = await fetch(INTUIT_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: basicAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Intuit token exchange failed: ${res.status} ${text.slice(0, 200)}`
      );
    }
    const json = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in,
    };
  } catch (err) {
    captureError(err, { subsystem: "qbo-auth", op: "exchangeCodeForTokens" });
    throw err;
  }
}

type CredentialRow = {
  id: string;
  provider: string;
  realmId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
};

export async function refreshAccessToken(
  credential: CredentialRow
): Promise<TokenResult> {
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credential.refreshToken,
    });
    const res = await fetch(INTUIT_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: basicAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Intuit token refresh failed: ${res.status} ${text.slice(0, 200)}`
      );
    }
    const json = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    const expiresAt = new Date(Date.now() + json.expires_in * 1000);
    // Intuit rotates refresh tokens periodically; the response may carry a
    // new refresh_token that we must persist. Wrap the update in a tx so a
    // partial write can't leave us with mismatched access/refresh halves.
    await prisma.$transaction(async (tx) => {
      await tx.integrationCredential.update({
        where: { id: credential.id },
        data: {
          accessToken: json.access_token,
          refreshToken: json.refresh_token,
          expiresAt,
          lastUsedAt: new Date(),
        },
      });
    });
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in,
    };
  } catch (err) {
    captureError(err, { subsystem: "qbo-auth", op: "refreshAccessToken" });
    throw err;
  }
}

export async function getOrRefreshCredential(
  provider: string = QBO_PROVIDER
) {
  if (!intuitConfigured()) {
    const err = new Error("Intuit OAuth not configured.");
    (err as Error & { status?: number }).status = 503;
    throw err;
  }
  const row = await prisma.integrationCredential.findFirst({
    where: { provider },
    orderBy: { connectedAt: "desc" },
  });
  if (!row) return null;
  const fiveMin = 5 * 60 * 1000;
  if (row.expiresAt.getTime() - Date.now() <= fiveMin) {
    const fresh = await refreshAccessToken(row);
    return {
      ...row,
      accessToken: fresh.accessToken,
      refreshToken: fresh.refreshToken,
      expiresAt: new Date(Date.now() + fresh.expiresIn * 1000),
    };
  }
  return row;
}

export async function disconnectCredential(
  provider: string = QBO_PROVIDER
): Promise<number> {
  const res = await prisma.integrationCredential.deleteMany({
    where: { provider },
  });
  return res.count;
}
