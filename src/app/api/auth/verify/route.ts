import { NextResponse } from "next/server";
import { consumeEmailVerification } from "@/lib/email-verification";
import { createSession, getCurrentUser, destroySession } from "@/lib/auth";
import { siteUrl } from "@/lib/site-url";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { hashEmailVerificationToken } from "@/lib/email-verification";
import { prisma } from "@/lib/db";
import { autoJoinByEmailDomain } from "@/lib/buyer-org-access";

export const runtime = "nodejs";

/**
 * Click-through verification target. Reads the token from the query string,
 * marks the user verified, signs them in.
 *
 * PLH-1 commit 2: session-fixation interstitial. If an existing session
 * cookie belongs to a different user than the one this token verifies,
 * we redirect to /confirm-action first instead of silently swapping
 * sessions. The interstitial POSTs back here.
 */
async function handle(req: Request, method: "GET" | "POST") {
  const limit = await rateLimit("generic", clientIp(req));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429 }
    );
  }
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  if (!token) {
    return NextResponse.redirect(siteUrl("/account?verified=expired"), {
      status: 303,
    });
  }

  // On GET, gate on a session-fixation check before consuming the token.
  if (method === "GET") {
    const current = await getCurrentUser();
    if (current) {
      // Peek at the token's owner without consuming it.
      const tokenHash = hashEmailVerificationToken(token);
      const owner = await prisma.user.findUnique({
        where: { emailVerificationTokenHash: tokenHash },
        select: { id: true },
      });
      if (owner && owner.id !== current.id) {
        return NextResponse.redirect(
          siteUrl(
            `/confirm-action?action=verify&token=${encodeURIComponent(token)}`
          ),
          { status: 303 }
        );
      }
    }
  }

  const user = await consumeEmailVerification(token);
  if (!user) {
    return NextResponse.redirect(siteUrl("/account?verified=expired"), {
      status: 303,
    });
  }
  // PLH-3y-3: domain auto-join. Now that the email is verified (proving the
  // user controls the address), check whether the domain matches a VERIFIED +
  // autoJoinEnabled org and join them. Best-effort: never blocks verification.
  const joined = await autoJoinByEmailDomain(user);
  // Clear any prior cookie before issuing a fresh one for the verified user.
  await destroySession();
  await createSession(user.id);
  if (joined) {
    return NextResponse.redirect(
      siteUrl(`/buyer-org?joined=${encodeURIComponent(joined.org.name)}`),
      { status: 303 }
    );
  }
  return NextResponse.redirect(siteUrl("/account?verified=1"), { status: 303 });
}

export async function GET(req: Request) {
  return handle(req, "GET");
}

export async function POST(req: Request) {
  return handle(req, "POST");
}
