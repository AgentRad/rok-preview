import type { Readiness } from "@/lib/supplier-access";

/**
 * Server-rendered "Go-live readiness" gauge for the supplier dashboard.
 * Shows N/10, the progress bar, item rows, and a big green banner once
 * every item is satisfied. When the supplier is already publicVisible
 * (admin has flipped them live), the banner switches to "Live".
 */
export default function GoLiveGauge({
  readiness,
  publicVisible,
}: {
  readiness: Readiness;
  publicVisible: boolean;
}) {
  const pct = Math.round((readiness.done / readiness.total) * 100);
  const allDone = readiness.ready;
  return (
    <div className="card go-live-card">
      <div className="card-head">
        <h2>Go-live readiness</h2>
        <span className="muted-text" style={{ fontSize: 13 }}>
          {readiness.done} of {readiness.total} complete
        </span>
      </div>
      <div className="card-body">
        <div className="go-live-bar" aria-hidden="true">
          <div
            className="go-live-bar-fill"
            style={{
              width: `${pct}%`,
              background: allDone ? "var(--green)" : "var(--amber-deep)",
            }}
          />
        </div>

        {publicVisible && allDone ? (
          <div className="alert alert-ok" style={{ marginTop: 14 }}>
            <strong>You&rsquo;re live.</strong> Buyers can see your products
            in the catalog, on brand storefronts, and in search results.
          </div>
        ) : allDone ? (
          <div className="alert alert-ok" style={{ marginTop: 14 }}>
            <strong>Ready to go live.</strong> Every onboarding item is
            done. An admin will flip your visibility on; your products will
            appear in the public catalog within minutes.
          </div>
        ) : publicVisible ? (
          <div className="alert alert-info" style={{ marginTop: 14 }}>
            Your storefront is live, but a few onboarding items still need
            attention. Knock the rest out to keep your account in good
            standing.
          </div>
        ) : (
          <div className="alert alert-info" style={{ marginTop: 14 }}>
            Buyers can&rsquo;t see your products yet. Finish the items below
            and an admin will turn your storefront on.
          </div>
        )}

        <ul className="checklist" style={{ marginTop: 14 }}>
          {readiness.items.map((it) => (
            <li
              key={it.key}
              className={"checklist-item" + (it.done ? " done" : "")}
            >
              <span className="checklist-bullet" aria-hidden="true">
                {it.done ? "✓" : ""}
              </span>
              <div className="checklist-text">
                <div className="checklist-label">{it.label}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
