import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyUnsubscribeToken } from "@/lib/email";

export const runtime = "nodejs";

/**
 * PLH-2 Phase 4d (D1): public one-click unsubscribe target for
 * List-Unsubscribe headers. Flips marketing + product flags to false
 * on a valid signed token. No login required (RFC 8058). Order emails
 * stay opt-in to keep buyers in the loop on real transactions; users
 * can disable them on /settings.
 *
 * PLH-3j P5: the GET HTML response now also embeds a one-click
 * Re-subscribe form (same signed token, posts to /api/email/resubscribe)
 * so the buyer who tapped Unsubscribe by accident does not have to find
 * /settings on their own.
 */
async function applyUnsubscribe(token: string | null): Promise<{
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
      data: {
        notifyMarketingEmails: false,
        notifyProductUpdates: false,
      },
    });
  } catch {
    return { ok: false, status: 404, message: "Account not found." };
  }
  return {
    ok: true,
    status: 200,
    message: "You have been unsubscribed from marketing and product updates.",
  };
}

function escAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const result = await applyUnsubscribe(token);
  // PLH-3j P5: render a one-tap Re-subscribe form on the success page.
  // Same signed token (verified again server-side on POST) so an attacker
  // who never had the original token cannot toggle the user's prefs.
  const resubscribeBlock =
    result.ok && token
      ? `<form method="POST" action="/api/email/resubscribe?token=${escAttr(token)}" style="margin-top:18px">
           <button type="submit" style="appearance:none;border:1px solid #1a1a1a;background:#1a1a1a;color:#fff;font:inherit;font-size:14px;padding:10px 16px;border-radius:4px;cursor:pointer">Re-subscribe</button>
         </form>
         <p style="font-size:12px;color:#888;margin-top:8px">Tapped Unsubscribe by accident? One click puts you back on the list.</p>`
      : "";
  const html = `<!doctype html><meta charset="utf-8"><title>Unsubscribe</title><body style="font-family:system-ui,sans-serif;max-width:520px;margin:60px auto;padding:0 24px;color:#1a1a1a"><h1 style="font-size:22px">${
    result.ok ? "Unsubscribed." : "Unsubscribe failed."
  }</h1><p>${result.message}</p>${resubscribeBlock}<p style="font-size:13px;color:#666;margin-top:24px">You can manage all email preferences from your account settings page.</p></body>`;
  return new Response(html, {
    status: result.status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// RFC 8058 one-click POST. Mail clients (Gmail, Apple Mail, Yahoo) hit
// this directly with no body when the user clicks Unsubscribe.
export async function POST(req: Request) {
  const url = new URL(req.url);
  const result = await applyUnsubscribe(url.searchParams.get("token"));
  return NextResponse.json(
    { ok: result.ok, message: result.message },
    { status: result.status }
  );
}
