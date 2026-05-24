import Link from "next/link";
import type { AttentionItem, AttentionSeverity } from "@/lib/attention";

const SEVERITY_LABEL: Record<AttentionSeverity, string> = {
  info: "Info",
  warning: "Action needed",
  urgent: "Urgent",
};

const SEVERITY_BADGE: Record<AttentionSeverity, string> = {
  info: "attn-info",
  warning: "attn-warning",
  urgent: "attn-urgent",
};

export default function AttentionFeed({
  items,
  emptyTitle,
  emptyBody,
  emptyAction,
}: {
  items: AttentionItem[];
  emptyTitle: string;
  emptyBody: string;
  emptyAction?: { label: string; href: string };
}) {
  if (items.length === 0) {
    return (
      <div className="attention attention-empty">
        <div className="invoice-meta-label" style={{ marginBottom: 6 }}>
          Today
        </div>
        <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-.02em" }}>
          {emptyTitle}
        </h2>
        <p
          className="muted-text"
          style={{ fontSize: 14, marginTop: 6, lineHeight: 1.5 }}
        >
          {emptyBody}
        </p>
        {emptyAction && (
          <div style={{ marginTop: 14 }}>
            <Link className="btn btn-dark btn-sm" href={emptyAction.href}>
              {emptyAction.label}
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="attention" aria-label="Needs your attention">
      <div className="attention-head">
        <span className="invoice-meta-label">Needs your attention</span>
        <span className="muted-text" style={{ fontSize: 12.5 }}>
          {items.length} item{items.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="attention-list">
        {items.map((it) => (
          <div key={it.id} className={"attention-card " + SEVERITY_BADGE[it.severity]}>
            <div className="attention-body">
              <div className="attention-title">{it.title}</div>
              <div className="attention-sub">{it.body}</div>
            </div>
            <div className="attention-side">
              <span className={"badge " + SEVERITY_BADGE[it.severity] + "-pill"}>
                {SEVERITY_LABEL[it.severity]}
              </span>
              <Link className="btn btn-dark btn-sm" href={it.actionHref}>
                {it.actionLabel}
              </Link>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
