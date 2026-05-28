import Link from "next/link";
import UnreadBadge from "./UnreadBadge";
import { getCurrentUser } from "@/lib/auth";
import { getUnreadCounts } from "@/lib/messages";

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
export default async function SupplierNav({
  active,
  sticky = false,
}: {
  active: SupplierNavKey;
  sticky?: boolean;
}) {
  // PLH-3p F4: badge the Dashboard tab with the supplier's unread thread
  // message count. Computed here so every supplier sub-route surface
  // (dashboard, products, payouts, quotes, settings) picks it up
  // without each page having to thread the prop through.
  const user = await getCurrentUser();
  let unreadCount = 0;
  if (user && (user.role === "SUPPLIER" || user.role === "ADMIN")) {
    const counts = await getUnreadCounts(user.id);
    unreadCount = counts.total;
  }
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
              {t.key === "dashboard" && (
                <UnreadBadge count={unreadCount} />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
