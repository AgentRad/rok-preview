export interface PaginationBarProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalCount: number;
  pageSize: number;
  baseHref: (page: number) => string;
}

export default function PaginationBar({
  currentPage,
  totalPages,
  baseHref,
  totalCount,
  pageSize,
}: PaginationBarProps) {
  if (totalPages <= 1) return null;

  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalCount);

  // Generate page numbers: 1, ..., curr-1, curr, curr+1, ..., last
  const pages: (number | string)[] = [];
  const windowSize = 1; // Pages to show on either side of current

  // Always show page 1
  pages.push(1);

  // Add ellipsis if needed
  const firstWindow = currentPage - windowSize;
  if (firstWindow > 2) {
    pages.push("...");
  }

  // Add window around current page
  for (let i = Math.max(2, firstWindow); i <= Math.min(totalPages - 1, currentPage + windowSize); i++) {
    if (pages[pages.length - 1] !== "...") {
      pages.push(i);
    }
  }

  // Add ellipsis if needed
  if (currentPage + windowSize < totalPages - 1) {
    pages.push("...");
  }

  // Always show last page (if more than 1)
  if (totalPages > 1 && pages[pages.length - 1] !== totalPages) {
    pages.push(totalPages);
  }

  return (
    <nav
      className="catalog-pager"
      aria-label="Catalog pagination"
      style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", marginTop: 16 }}
    >
      {currentPage > 1 ? (
        <a
          href={baseHref(currentPage - 1)}
          className="btn btn-ghost btn-sm"
          style={{ textDecoration: "none" }}
        >
          ← Previous
        </a>
      ) : (
        <span className="btn btn-ghost btn-sm" style={{ opacity: 0.4 }}>
          ← Previous
        </span>
      )}

      <span style={{ fontSize: 13, color: "var(--muted)" }}>
        {start} to {end} of {totalCount}
      </span>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {pages.map((p, idx) => {
          if (p === "...") {
            return (
              <span key={`ellipsis-${idx}`} style={{ color: "var(--muted)", fontSize: 12 }}>
                …
              </span>
            );
          }

          const pageNum = p as number;
          const isCurrentPage = pageNum === currentPage;

          return (
            <a
              key={pageNum}
              href={baseHref(pageNum)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: "var(--radius-sm)",
                backgroundColor: isCurrentPage ? "var(--ink)" : "transparent",
                color: isCurrentPage ? "var(--paper)" : "var(--ink)",
                textDecoration: "none",
                fontSize: 13,
                fontWeight: isCurrentPage ? 600 : 400,
                border: isCurrentPage ? "none" : "1px solid var(--line-strong)",
                cursor: "pointer",
              }}
            >
              {pageNum}
            </a>
          );
        })}
      </div>

      {currentPage < totalPages ? (
        <a
          href={baseHref(currentPage + 1)}
          className="btn btn-ghost btn-sm"
          style={{ textDecoration: "none" }}
        >
          Next →
        </a>
      ) : (
        <span className="btn btn-ghost btn-sm" style={{ opacity: 0.4 }}>
          Next →
        </span>
      )}
    </nav>
  );
}
