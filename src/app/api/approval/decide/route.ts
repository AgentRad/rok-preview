import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyApprovalToken } from "@/lib/approval-token";
import { advanceApproval } from "@/lib/approval";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * PLH-3y-6 C4: one-click approve / reject from approver email.
 * GET or POST both accepted so email clients that prefetch GET still work
 * (the token is single-use in spirit; in practice it stays valid until the
 * step resolves, after which advanceApproval returns null).
 *
 * Query params: order, member, action (approve|reject), t (HMAC token)
 * On success: 303 redirect to /orders/[id] with a status banner.
 * On reject action without reason: 303 redirect to /approval/reject/[token]
 * page where the approver can enter a reason before confirming.
 */
export async function GET(req: Request) {
  return handleDecide(req);
}
export async function POST(req: Request) {
  return handleDecide(req);
}

async function handleDecide(req: Request) {
  // Rate-limit by IP to slow brute-force token sweeping.
  const limit = await rateLimit("generic", `approval-decide:${clientIp(req)}`);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const url = new URL(req.url);
  const orderId = url.searchParams.get("order") || "";
  const memberId = url.searchParams.get("member") || "";
  const action = url.searchParams.get("action") || "";
  const token = url.searchParams.get("t") || "";

  if (!verifyApprovalToken(orderId, memberId, action, token)) {
    return NextResponse.redirect(new URL("/orders/" + encodeURIComponent(orderId) + "?approval=invalid", req.url));
  }

  // For reject via GET (one-click from email): redirect to the reason page.
  // For reject via POST (from the reason page): process the rejection with body.reason.
  if (action === "reject") {
    const isPost = req.method === "POST";
    if (!isPost) {
      return NextResponse.redirect(
        new URL(
          `/approval/reject/${encodeURIComponent(token)}?order=${encodeURIComponent(orderId)}&member=${encodeURIComponent(memberId)}`,
          req.url
        )
      );
    }
    // POST from the reject page: read the reason from the request body.
    const body = await req.json().catch(() => ({}));
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";

    const member = await prisma.buyerOrgMember.findUnique({
      where: { id: memberId },
      select: { id: true },
    });
    if (!member) {
      return NextResponse.json({ error: "Invalid token." }, { status: 400 });
    }

    const outcome = await advanceApproval({
      orderId,
      deciderMemberId: memberId,
      decision: "REJECT",
      reason,
    });
    if (!outcome) {
      return NextResponse.json({ error: "This step has already been resolved." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, approvalStatus: outcome });
  }

  // Approve: verify member is still in the org + order is still pending.
  const member = await prisma.buyerOrgMember.findUnique({
    where: { id: memberId },
    select: { id: true },
  });
  if (!member) {
    return NextResponse.redirect(new URL("/orders/" + encodeURIComponent(orderId) + "?approval=invalid", req.url));
  }

  const outcome = await advanceApproval({
    orderId,
    deciderMemberId: memberId,
    decision: "APPROVE",
  });

  if (!outcome) {
    return NextResponse.redirect(new URL("/orders/" + encodeURIComponent(orderId) + "?approval=already-resolved", req.url));
  }

  return NextResponse.redirect(new URL("/orders/" + encodeURIComponent(orderId) + "?approval=approved", req.url));
}
