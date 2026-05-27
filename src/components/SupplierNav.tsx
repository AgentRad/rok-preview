import Link from "next/link";

export type SupplierNavKey =
  | "dashboard"
  | "products"
  | "quotes"
  | "payouts"
  | "settings";

const TABS: { key: SupplierNavKey; label: string; href: string }[] = [
  { key: "dashboard", label: "Dashboard", href: "/supplier" },
  { key: "products", label: "Products", href: "/supplier/products" },
  { key: "quotes", label: "Quotes", href: "/supplier/quotes" },
  { key: "payouts", label: "Payouts", href: "/supplier/payouts" },
  { key: "settings", label: "Settings", href: "/supplier/settings" },
];

// PLH-3l: supplier dashboard IA split. Five tabs max. Active state is set
// from the server parent via the `active` prop so this stays a server
// component and doesn't pull in usePathname() at the leaf.
export default function SupplierNav({
  active,
  sticky = false,
}: {
  active: SupplierNavKey;
  sticky?: boolean;
}) {
  return (
    <nav
      aria-label="Supplier"
      style={{
        background: "var(--surface)",
        borderBottom: "1px solid var(--line-strong)",
        position: sticky ? "sticky" : "static",
        top: sticky ? 0 : undefined,
        zIndex: sticky ? 40 : undefined,
      }}
    >
      <div
        style={{
          maxWidth: "var(--maxw)",
          margin: "0 auto",
          padding: "0 32px",
          display: "flex",
          gap: 22,
          alignItems: "center",
          overflowX: "auto",
        }}
      >
        {TABS.map((t) => {
          const isActive = t.key === active;
          return (
            <Link
              key={t.key}
              href={t.href}
              style={{
                fontSize: 14,
                color: isActive ? "var(--ink)" : "var(--ink-soft)",
                textDecoration: "none",
                padding: "12px 0",
                borderBottom: isActive
                  ? "2px solid var(--ink)"
                  : "2px solid transparent",
                fontWeight: isActive ? 600 : 400,
                whiteSpace: "nowrap",
              }}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
