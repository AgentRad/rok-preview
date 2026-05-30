import Link from "next/link";

export type SupplierChecklistItem = {
  key: string;
  label: string;
  done: boolean;
  href?: string;
  note?: string;
};

export default function SupplierChecklist({
  items,
}: {
  items: SupplierChecklistItem[];
}) {
  const total = items.length;
  const completed = items.filter((i) => i.done).length;
  // Hide entirely once everything is complete; nothing useful to show.
  if (completed === total) return null;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Get set up</h2>
        <span className="muted-text" style={{ fontSize: 13 }}>
          {completed} of {total} complete
        </span>
      </div>
      <div className="card-body">
        <ul className="checklist">
          {items.map((it) => (
            <li key={it.key} className={"checklist-item" + (it.done ? " done" : "")}>
              <span className="checklist-bullet" aria-hidden="true">
                {it.done ? "✓" : ""}
              </span>
              <div className="checklist-text">
                <div className="checklist-label">
                  {it.href && !it.done ? (
                    <Link href={it.href}>{it.label}</Link>
                  ) : (
                    it.label
                  )}
                </div>
                {it.note && <div className="checklist-note">{it.note}</div>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
