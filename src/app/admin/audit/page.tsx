import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { AUDIT_ACTIONS } from "@/lib/audit";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const TARGET_TYPES = [
  "Supplier",
  "SupplierDocument",
  "SupplierApplication",
  "Address",
  "Payout",
  "User",
  "Order",
  "ReturnRequest",
  "QuoteRequest",
];

type SearchParams = {
  actor?: string;
  action?: string;
  targetType?: string;
  from?: string;
  to?: string;
  page?: string;
};

function parseDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (isNaN(d.getTime())) return undefined;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole("ADMIN");
  const sp = await searchParams;
  const actor = sp.actor?.trim() || "";
  const action = sp.action?.trim() || "";
  const targetType = sp.targetType?.trim() || "";
  const from = parseDate(sp.from);
  const to = parseDate(sp.to, true);
  const page = Math.max(1, parseInt(sp.page || "1", 10) || 1);

  const where: Prisma.AuditLogWhereInput = {};
  if (actor) {
    where.OR = [
      { actorEmail: { contains: actor, mode: "insensitive" } },
      { actorId: actor },
    ];
  }
  if (action) where.action = action;
  if (targetType) where.targetType = targetType;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) where.createdAt.lte = to;
  }

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function hrefWith(patch: Partial<SearchParams>) {
    const next = new URLSearchParams();
    const merged: SearchParams = {
      actor,
      action,
      targetType,
      from: sp.from,
      to: sp.to,
      page: String(page),
      ...patch,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== "" && !(k === "page" && v === "1")) {
        next.set(k, String(v));
      }
    }
    const s = next.toString();
    return s ? `/admin/audit?${s}` : "/admin/audit";
  }

  return (
    <>
      <main id="main" className="app-page">
        <div className="page-pad">
          <h1 className="page-title">Audit log</h1>
          <p className="page-sub">
            Every admin mutation lands here: supplier approvals, document
            reviews, payout state changes, impersonation, tax-exempt cert
            decisions. Read-only. Append-only.{" "}
            <Link
              href="/admin"
              style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
            >
              ← Back to admin console
            </Link>
          </p>

          <form
            method="GET"
            action="/admin/audit"
            className="card"
            style={{ padding: 14 }}
          >
            <div className="form-row four">
              <div>
                <label>Actor (email)</label>
                <input
                  type="text"
                  name="actor"
                  defaultValue={actor}
                  placeholder="admin@partsport.example"
                />
              </div>
              <div>
                <label>Action</label>
                <select name="action" defaultValue={action}>
                  <option value="">All actions</option>
                  {AUDIT_ACTIONS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Target type</label>
                <select name="targetType" defaultValue={targetType}>
                  <option value="">All target types</option>
                  {TARGET_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>From / To</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="date"
                    name="from"
                    defaultValue={sp.from || ""}
                  />
                  <input
                    type="date"
                    name="to"
                    defaultValue={sp.to || ""}
                  />
                </div>
              </div>
            </div>
            <div className="row-gap" style={{ marginTop: 8 }}>
              <button type="submit" className="btn btn-primary btn-sm">
                Apply filters
              </button>
              <Link className="btn btn-ghost btn-sm" href="/admin/audit">
                Clear
              </Link>
            </div>
          </form>

          <div className="card" style={{ marginTop: 18 }}>
            <div className="card-head">
              <h2>
                {total} event{total === 1 ? "" : "s"}
                {total > 0 ? `, page ${page} of ${totalPages}` : ""}
              </h2>
            </div>
            {rows.length === 0 ? (
              <div className="empty-block">
                <h3>No events match these filters</h3>
                <p>
                  Trigger an admin mutation (approve a doc, mark a payout
                  paid, flip visibility) and it appears here.
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Actor</th>
                      <th>Action</th>
                      <th>Target</th>
                      <th>Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
                          {/* Audit log uses UTC ISO format intentionally so
                              forensic timestamps don't drift across the
                              reviewer's local timezone. Every other page
                              uses locale date for readability. */}
                          {r.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                        </td>
                        <td style={{ fontSize: 12.5 }}>{r.actorEmail}</td>
                        <td>
                          <span className="audit-action">{r.action}</span>
                        </td>
                        <td style={{ fontSize: 12.5 }}>
                          <div>{r.targetType}</div>
                          <div className="muted-text" style={{ fontSize: 11 }}>
                            {r.targetId}
                          </div>
                        </td>
                        <td style={{ fontSize: 13 }}>{r.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {totalPages > 1 && (
              <nav
                className="catalog-pager"
                aria-label="Audit log pagination"
                style={{ padding: "14px 18px" }}
              >
                {page > 1 ? (
                  <Link
                    className="btn btn-ghost btn-sm"
                    href={hrefWith({ page: String(page - 1) })}
                  >
                    ← Previous
                  </Link>
                ) : (
                  <span className="btn btn-ghost btn-sm" style={{ opacity: 0.4 }}>
                    ← Previous
                  </span>
                )}
                <span className="muted-text" style={{ fontSize: 13 }}>
                  Page {page} of {totalPages}
                </span>
                {page < totalPages ? (
                  <Link
                    className="btn btn-ghost btn-sm"
                    href={hrefWith({ page: String(page + 1) })}
                  >
                    Next →
                  </Link>
                ) : (
                  <span className="btn btn-ghost btn-sm" style={{ opacity: 0.4 }}>
                    Next →
                  </span>
                )}
              </nav>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
