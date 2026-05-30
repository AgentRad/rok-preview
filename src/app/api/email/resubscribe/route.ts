import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyUnsubscribeToken } from "@/lib/email";

export const runtime = "nodejs";

/**
 * PLH-3j P5: companion to /api/email/unsubscribe. Same signed token
 * (re-verified server-side here) flips notifyMarketingEmails back on so
 * a buyer who tapped Unsubscribe by accident can recover in one click
 * from the unsubscribe response page.
 *
 * notifyProductUpdates is intentionally NOT auto-restored: the user may
 * have wanted only marketing off and product updates off both; the
 * primary undo target is the marketing emails. The user can re-enable
 * product updates from /settings if they want.
 */
async function applyResubscribe(token: string | null): Promise<{
  ok: boolean;
  status: number;
  message: string;
}> {
  if (!token) {
    return { ok: false, status: 400, message: "Missing token." };
  }
  const userId = verifyUnsubscribeToken(token);
  if (!userId) {
    return { ok: false, status: 400, message: "Invalid or expired link." };
  }
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { notifyMarketingEmails: true },
    });
  } catch {
    return { ok: false, status: 404, message: "Account not found." };
  }
  return {
    ok: true,
    status: 200,
    message: "You are re-subscribed to marketing emails.",
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const result = await applyResubscribe(url.searchParams.get("token"));
  const html = `<!doctype html><meta charset="utf-8"><title>Re-subscribed</title><body style="font-family:system-ui,sans-serif;max-width:520px;margin:60px auto;padding:0 24px;color:#1a1a1a"><h1 style="font-size:22px">${
    result.ok ? "You are re-subscribed." : "Re-subscribe failed."
  }</h1><p>${result.message}</p><p style="font-size:13px;color:#666;margin-top:24px">Manage all email preferences from your account settings page.</p></body>`;
  return new Response(html, {
    status: result.status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const result = await applyResubscribe(url.searchParams.get("token"));
  // Browser form submit lands here. Render the same HTML page so the
  // buyer sees confirmation without a JSON dump.
  const accepts = (req.headers.get("accept") || "").toLowerCase();
  if (accepts.includes("text/html")) {
    const html = `<!doctype html><meta charset="utf-8"><title>Re-subscribed</title><body style="font-family:system-ui,sans-serif;max-width:520px;margin:60px auto;padding:0 24px;color:#1a1a1a"><h1 style="font-size:22px">${
      result.ok ? "You are re-subscribed." : "Re-subscribe failed."
    }</h1><p>${result.message}</p><p style="font-size:13px;color:#666;margin-top:24px">Manage all email preferences from your account settings page.</p></body>`;
    return new Response(html, {
      status: result.status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return NextResponse.json(
    { ok: result.ok, message: result.message },
    { status: result.status }
  );
}
