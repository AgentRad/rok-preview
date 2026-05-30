import { NextResponse } from "next/server";
import { resolveTxt } from "node:dns/promises";
import { prisma } from "@/lib/db";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";

/**
 * PLH-3y-3: DNS TXT verification for claimed org email domains.
 *
 * Walks PENDING and VERIFIED domains, looks up the TXT records on
 * _partsport.<domain>, and looks for the value partsport-verify=<token>.
 *  - PENDING + record found  -> VERIFIED (verifiedAt set, audit).
 *  - PENDING + not found      -> stays PENDING until the claim is older than
 *                                VERIFY_WINDOW_DAYS, then FAILED (audit).
 *  - VERIFIED + record gone    -> FAILED + autoJoinEnabled forced off so we
 *                                stop auto-joining on a domain we no longer
 *                                control (audit). Surfaces as the org-admin
 *                                attention banner on /buyer-org.
 *
 * MAX_PER_RUN cap + hasMore, ASC by txtLastCheckedAt (nulls first) so the
 * least-recently-checked domains get priority. Mirrors the PLH-2 4e cron
 * cap-and-resume pattern.
 *
 * Schedule: vercel.json runs this at 06:30 UTC daily, alongside the other
 * housekeeping crons and before the money crons.
 */

const MAX_PER_RUN = 200;
const VERIFY_WINDOW_DAYS = 7;

async function adminActor() {
  return { id: "system", email: "system@partsport.cron" };
}

function recordValue(token: string): string {
  return `partsport-verify=${token}`;
}

async function txtHasValue(host: string, expected: string): Promise<boolean> {
  try {
    const records = await resolveTxt(host);
    // resolveTxt returns string[][]; each record's chunks are concatenated.
    return records.some((chunks) => chunks.join("").trim() === expected);
  } catch {
    // ENOTFOUND / ENODATA / SERVFAIL all mean "not present right now".
    return false;
  }
}

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const failCutoff = new Date(now.getTime() - VERIFY_WINDOW_DAYS * 86400000);

  const candidates = await prisma.buyerOrgDomain.findMany({
    where: { status: { in: ["PENDING", "VERIFIED"] } },
    take: MAX_PER_RUN + 1,
    orderBy: [{ txtLastCheckedAt: { sort: "asc", nulls: "first" } }],
  });
  const hasMore = candidates.length > MAX_PER_RUN;
  const batch = hasMore ? candidates.slice(0, MAX_PER_RUN) : candidates;

  const actor = await adminActor();
  let verified = 0;
  let failed = 0;
  let stillPending = 0;
  const errors: string[] = [];

  for (const d of batch) {
    try {
      const host = `_partsport.${d.domain}`;
      const found = await txtHasValue(host, recordValue(d.verificationToken));

      if (found) {
        const wasVerified = d.status === "VERIFIED";
        await prisma.buyerOrgDomain.update({
          where: { id: d.id },
          data: {
            status: "VERIFIED",
            verifiedAt: d.verifiedAt ?? now,
            txtLastCheckedAt: now,
          },
        });
        if (!wasVerified) {
          verified++;
          await writeAuditLog({
            actor,
            action: "BUYER_ORG_DOMAIN_VERIFIED",
            targetType: "BuyerOrg",
            targetId: d.buyerOrgId,
            summary: `Domain ${d.domain} verified via DNS TXT.`,
            metadata: { domainId: d.id, domain: d.domain },
          });
        }
        continue;
      }

      // Not found.
      if (d.status === "VERIFIED") {
        // Record disappeared on a previously-verified domain: fail it and
        // pause auto-join so we stop joining on a domain we can't confirm.
        await prisma.buyerOrgDomain.update({
          where: { id: d.id },
          data: { status: "FAILED", autoJoinEnabled: false, txtLastCheckedAt: now },
        });
        failed++;
        await writeAuditLog({
          actor,
          action: "BUYER_ORG_DOMAIN_FAILED",
          targetType: "BuyerOrg",
          targetId: d.buyerOrgId,
          summary: `Domain ${d.domain} TXT record disappeared; auto-join paused.`,
          metadata: { domainId: d.id, domain: d.domain, reason: "txt_disappeared" },
        });
      } else if (d.createdAt < failCutoff) {
        // PENDING past the verification window: mark FAILED.
        await prisma.buyerOrgDomain.update({
          where: { id: d.id },
          data: { status: "FAILED", txtLastCheckedAt: now },
        });
        failed++;
        await writeAuditLog({
          actor,
          action: "BUYER_ORG_DOMAIN_FAILED",
          targetType: "BuyerOrg",
          targetId: d.buyerOrgId,
          summary: `Domain ${d.domain} never verified within ${VERIFY_WINDOW_DAYS} days.`,
          metadata: { domainId: d.id, domain: d.domain, reason: "window_expired" },
        });
      } else {
        await prisma.buyerOrgDomain.update({
          where: { id: d.id },
          data: { txtLastCheckedAt: now },
        });
        stillPending++;
      }
    } catch (err) {
      captureError(err, {
        subsystem: "cron",
        op: "verify-org-domains",
        domainId: d.id,
      });
      errors.push(`${d.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    processed: batch.length,
    verified,
    failed,
    stillPending,
    errors,
    hasMore,
  });
}
