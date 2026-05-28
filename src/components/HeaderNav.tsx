"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Brand from "./Brand";
import UnreadBadge from "./UnreadBadge";
import { cartCount, onCartChange } from "@/lib/cart";

type NavUser = { name: string; role: string } | null;

const DASHBOARD: Record<string, { href: string; label: string }> = {
  ADMIN: { href: "/admin", label: "Admin console" },
  SUPPLIER: { href: "/supplier", label: "Supplier dashboard" },
  BUYER: { href: "/account", label: "My orders" },
  MANUFACTURER: { href: "/oem", label: "Manufacturer dashboard" },
};

export default function HeaderNav({
  user,
  showSearch = true,
  unreadCount = 0,
  directUnread = 0,
}: {
  user: NavUser;
  showSearch?: boolean;
  /** PLH-3p F4: order/quote unread total. Badges the dashboard link. */
  unreadCount?: number;
  /** PLH-3q P4: direct-message unread total. Badges the /messages link. */
  directUnread?: number;
}) {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userBtnRef = useRef<HTMLButtonElement>(null);
  const navLinksRef = useRef<HTMLDivElement>(null);
  const navToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setCount(cartCount());
    return onCartChange(() => setCount(cartCount()));
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Escape + focus management for the user-menu dropdown.
  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        userBtnRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    const first = userMenuRef.current?.querySelector<HTMLElement>(
      "a, button, [tabindex]:not([tabindex='-1'])"
    );
    first?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Escape + focus management for the mobile nav drawer.
  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMobileOpen(false);
        navToggleRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    const first = navLinksRef.current?.querySelector<HTMLElement>(
      "a, button, [tabindex]:not([tabindex='-1'])"
    );
    first?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setMenuOpen(false);
    router.push("/");
    router.refresh();
  }

  const dash = user ? DASHBOARD[user.role] : null;

  return (
    <nav className="nav" aria-label="Primary">
      <div className="nav-inner">
        <Brand />
        {showSearch && (
          <form className="nav-search" action="/catalog" method="get" role="search">
            <input
              type="text"
              name="q"
              placeholder="Search for any part, equipment, or part number…"
              aria-label="Search parts"
            />
            <button type="submit" aria-label="Search">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </button>
          </form>
        )}

        <div
          id="primary-nav-links"
          ref={navLinksRef}
          className={"nav-links" + (mobileOpen ? " open" : "")}
        >
          {showSearch && (
            <form
              className="nav-search nav-search-mobile"
              action="/catalog"
              method="get"
              role="search"
              onSubmit={() => setMobileOpen(false)}
            >
              <input
                type="text"
                name="q"
                placeholder="Search parts…"
                aria-label="Search parts"
              />
              <button type="submit" aria-label="Search">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </button>
            </form>
          )}
          <Link href="/catalog" onClick={() => setMobileOpen(false)}>Catalog</Link>
          <Link href="/how-it-works" onClick={() => setMobileOpen(false)}>How it works</Link>
          {/* Hide the "For X" recruitment links for users who are already that role. */}
          {user?.role !== "SUPPLIER" && (
            <Link href="/suppliers" onClick={() => setMobileOpen(false)}>For suppliers</Link>
          )}
          {user?.role !== "MANUFACTURER" && (
            <Link href="/manufacturers" onClick={() => setMobileOpen(false)}>For manufacturers</Link>
          )}
          {dash && (
            <Link href={dash.href} onClick={() => setMobileOpen(false)}>
              {dash.label}
              <UnreadBadge count={unreadCount} />
            </Link>
          )}
          {user && user.role !== "MANUFACTURER" && (
            <Link href="/messages" onClick={() => setMobileOpen(false)}>
              Messages
              <UnreadBadge count={directUnread} />
            </Link>
          )}
          {/* Cart is for buyers and anonymous shoppers. Suppliers, OEMs,
              and admins don't transact through it (the page redirects
              non-buyers out; admins use 'Manage as' impersonation for
              buyer support, not their admin account to shop). */}
          {(!user || user.role === "BUYER") && (
            <Link href="/cart" className="nav-cart" onClick={() => setMobileOpen(false)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="20" r="1.5" />
                <circle cx="18" cy="20" r="1.5" />
                <path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 2-1.5L23 7H6" />
              </svg>
              Cart
              {count > 0 && <span className="cart-count">{count}</span>}
            </Link>
          )}

          {user ? (
            <div className="nav-user" ref={menuRef}>
              <button
                ref={userBtnRef}
                type="button"
                className="nav-user-btn"
                aria-haspopup="true"
                aria-expanded={menuOpen}
                aria-controls="nav-user-menu"
                onClick={() => setMenuOpen((o) => !o)}
              >
                <span className="nav-avatar">
                  {user.name.charAt(0).toUpperCase()}
                </span>
                {user.name.split(" ")[0]}
              </button>
              {menuOpen && (
                <div id="nav-user-menu" ref={userMenuRef} className="nav-menu">
                  <div className="nm-head">
                    <div className="nm-name">{user.name}</div>
                    <div className="nm-role">{user.role.toLowerCase()}</div>
                  </div>
                  {dash && <Link href={dash.href} onClick={() => setMenuOpen(false)}>{dash.label}</Link>}
                  <Link href="/settings" onClick={() => setMenuOpen(false)}>Settings</Link>
                  <button onClick={logout}>Sign out</button>
                </div>
              )}
            </div>
          ) : (
            <Link href="/login" onClick={() => setMobileOpen(false)}>Sign in</Link>
          )}
        </div>

        <button
          ref={navToggleRef}
          type="button"
          className="nav-toggle"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          aria-controls="primary-nav-links"
          onClick={() => setMobileOpen((o) => !o)}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
      </div>
    </nav>
  );
}
