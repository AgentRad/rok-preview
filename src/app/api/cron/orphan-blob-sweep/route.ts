import { NextResponse } from "next/server";
import { list, del, type ListBlobResult } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";

/**
 * PLH-3h P5: orphan blob sweep.
 *
 * Walks every blob in the Vercel Blob store under the `products/` prefix
 * and deletes any blob that meets BOTH:
 *   1. No ProductImage row references its url.
 *   2. The blob's uploadedAt is older than 7 days.
 *
 * The 7-day grace period exists because the supplier image upload route
 * writes the blob first and then creates the ProductImage row. If the
 * DB insert fails between those two steps (timeout, deploy mid-request),
 * the blob is briefly orphaned but the supplier will likely retry within
 * minutes. Sweeping younger blobs risks killing an in-flight upload's
 * payload before its row lands.
 *
 * Bounded to MAX_PER_RUN=500 deletions per run, mirroring the PLH-2 4e
 * cron pattern (auto-deliver, reserve-release, connect-sync). When the
 * cap is hit the response returns hasMore=true so the next run picks up
 * where this one left off.
 *
 * Schedule: vercel.json runs this at 06:00 UTC daily, after the 03/04/05
 * crons but before the 09:xx payment-related crons.
 */

const MAX_PER_RUN = 500;
const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

async function adminActor() {
  return { id: "system", email: "system@partsport.cron" };
}

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "Vercel Blob is not configured." },
      { status: 503 }
    );
  }

  const actor = await adminActor();
  const cutoff = Date.now() - GRACE_MS;

  let processed = 0;
  let deleted = 0;
  const errors: string[] = [];
  let cursor: string | undefined = undefined;
  let hasMore = false;

  try {
    paginate: while (true) {
      const page: ListBlobResult = await list({
        prefix: "products/",
        cursor,
        limit: 1000,
      });

      for (const blob of page.blobs) {
        processed++;
        if (!blob.pathname.startsWith("products/")) continue;
        const uploadedMs = blob.uploadedAt.getTime();
        if (uploadedMs >= cutoff) continue;

        try {
          const existing = await prisma.productImage.findFirst({
            where: { url: blob.url },
            select: { id: true },
          });
          if (existing) continue;

          await del(blob.url);
          deleted++;

          await writeAuditLog({
            actor,
            action: "ORPHAN_BLOB_DELETED",
            targetType: "ProductImage",
            targetId: blob.pathname,
            summary: `Deleted orphan blob ${blob.pathname}`,
            metadata: {
              url: blob.url,
              pathname: blob.pathname,
              uploadedAt: blob.uploadedAt.toISOString(),
              size: blob.size,
            },
          });

          if (deleted >= MAX_PER_RUN) {
            hasMore = true;
            break paginate;
          }
        } catch (err) {
          captureError(err, {
            subsystem: "cron",
            op: "orphan-blob-sweep",
            pathname: blob.pathname,
          });
          errors.push(
            `${blob.pathname}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      if (!page.hasMore || !page.cursor) break;
      cursor = page.cursor;
    }
  } catch (err) {
    captureError(err, { subsystem: "cron", op: "orphan-blob-sweep" });
    errors.push(
      `list failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return NextResponse.json({
    ok: true,
    processed,
    deleted,
    errors,
    hasMore,
  });
}
