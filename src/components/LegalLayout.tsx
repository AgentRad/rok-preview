import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

export type LegalSection = {
  /** Short anchor-friendly slug used as `id` for in-page links. */
  id: string;
  heading: string;
  /** Paragraphs of body copy. Each entry is rendered as a `<p>`. */
  body: string[];
  /** Optional bullet list rendered after the body paragraphs. */
  bullets?: string[];
};

const NAV: { href: string; label: string }[] = [
  { href: "/legal/terms", label: "Terms of Service" },
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/acceptable-use", label: "Acceptable Use" },
  { href: "/legal/returns", label: "Returns and Refunds" },
  { href: "/legal/supplier-agreement", label: "Supplier Agreement" },
];

/**
 * Shared layout for /legal/* pages. Renders header, sticky in-page nav
 * across the 5 documents, the document body, and a "last updated" footer.
 * Each page passes its own title + lastUpdated + sections.
 */
export default function LegalLayout({
  currentHref,
  title,
  lede,
  lastUpdated,
  sections,
  templateWarning = true,
}: {
  currentHref: string;
  title: string;
  /** One-sentence summary shown under the title. */
  lede: string;
  /** ISO date, e.g. "2026-05-25". Rendered verbatim. */
  lastUpdated: string;
  sections: LegalSection[];
  /** When true (default), renders the placeholder warning banner at the top. */
  templateWarning?: boolean;
}) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="app-page">
        <div className="legal-wrap">
          <aside className="legal-nav" aria-label="Legal documents">
            <h3>Legal</h3>
            <ul>
              {NAV.map((n) => (
                <li
                  key={n.href}
                  className={n.href === currentHref ? "is-current" : ""}
                >
                  <Link href={n.href}>{n.label}</Link>
                </li>
              ))}
            </ul>
            <p className="legal-nav-foot">
              Questions:{" "}
              <a href="mailto:legal@partsport.agentgaming.gg">
                legal@partsport.agentgaming.gg
              </a>
            </p>
          </aside>

          <article className="legal-doc">
            {templateWarning && (
              <div className="alert alert-info" style={{ marginBottom: 20 }}>
                <strong>Template only.</strong> This document is a structural
                starting point for PartsPort&rsquo;s legal pages, not legal
                advice and not the final operative agreement. The platform
                owner is replacing it with attorney-reviewed copy before the
                public launch. Do not rely on it for any decision in the
                meantime.
              </div>
            )}
            <header className="legal-doc-head">
              <span className="eyebrow">PartsPort, Inc.</span>
              <h1>{title}</h1>
              <p className="legal-lede">{lede}</p>
              <div className="legal-meta">Last updated {lastUpdated}</div>
            </header>

            <nav className="legal-toc" aria-label="On this page">
              <strong>On this page:</strong>{" "}
              {sections.map((s, i) => (
                <span key={s.id}>
                  <a href={`#${s.id}`}>{s.heading}</a>
                  {i < sections.length - 1 ? " · " : ""}
                </span>
              ))}
            </nav>

            {sections.map((s) => (
              <section key={s.id} id={s.id} className="legal-section">
                <h2>{s.heading}</h2>
                {s.body.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
                {s.bullets && s.bullets.length > 0 && (
                  <ul>
                    {s.bullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}

            <footer className="legal-doc-foot">
              Last updated {lastUpdated}. Email{" "}
              <a href="mailto:legal@partsport.agentgaming.gg">
                legal@partsport.agentgaming.gg
              </a>{" "}
              with questions.
            </footer>
          </article>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
