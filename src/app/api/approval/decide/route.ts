import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyApprovalToken } from "@/lib/approval-token";
import { advanceApproval } from "@/lib/approval";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * PLH-3y-6 C4: one-click approve / reject from approver email.
 *
 * SECURITY: neither approve nor reject may mutate on GET. Mail security
 * scanners, link-preview bots, and corporate proxies routinely issue GET on
 * inbound-mail links, which would silently approve (or reject) over-limit
 * orders. So a GET renders a lightweight confirmation interstitial
 * (/approval/approve/[token] or /approval/reject/[token]) with a button that
 * POSTs back here; the actual decision happens only on POST.
 *
 * Query params: order, member, action (approve|reject), t (HMAC token)
 * On GET: 303 redirect to the matching confirm page.
 * On POST: runs advanceApproval (which enforces the BUG 1 self-approval check)
 * and returns JSON.
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

  // Approve. Mirror the reject pattern: a GET (which may be an email-client
  // prefetch or a mail-scanner bot) renders a confirmation interstitial; the
  // actual approval only happens on the POST from that page.
  if (req.method !== "POST") {
    return NextResponse.redirect(
      new URL(
        `/approval/approve/${encodeURIComponent(token)}?order=${encodeURIComponent(orderId)}&member=${encodeURIComponent(memberId)}`,
        req.url
      )
    );
  }

  // POST from the approve confirm page: verify member is still in the org and
  // advance the approval.
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
    decision: "APPROVE",
  });

  if (outcome && typeof outcome === "object" && "error" in outcome) {
    return NextResponse.json({ error: outcome.error }, { status: 400 });
  }
  if (!outcome) {
    return NextResponse.json({ error: "This step has already been resolved." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, approvalStatus: outcome });
}
