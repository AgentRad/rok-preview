"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Brand from "./Brand";
import { cartCount, onCartChange } from "@/lib/cart";

type NavUser = { name: string; role: string } | null;

const DASHBOARD: Record<string, { href: string; label: string }> = {
  ADMIN: { href: "/admin", label: "Admin console" },
  SUPPLIER: { href: "/supplier", label: "Supplier dashboard" },
  BUYER: { href: "/account", label: "My orders" },
  MANUFACTURER: { href: "/oem", label: "Manufacturer dashboard" },
};

export default function HeaderNav({ user }: { user: NavUser }) {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
        <form className="nav-search" action="/catalog" method="get" role="search">
          <input
            type="text"
            name="q"
            placeholder="Search transformers, breakers, relays, conductors…"
            aria-label="Search parts"
          />
          <button type="submit" aria-label="Search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </button>
        </form>

        <div className={"nav-links" + (mobileOpen ? " open" : "")}>
          <Link href="/catalog" onClick={() => setMobileOpen(false)}>Catalog</Link>
          <Link href="/how-it-works" onClick={() => setMobileOpen(false)}>How it works</Link>
          <Link href="/suppliers" onClick={() => setMobileOpen(false)}>For suppliers</Link>
          {dash && (
            <Link href={dash.href} onClick={() => setMobileOpen(false)}>
              {dash.label}
            </Link>
          )}
          <Link href="/cart" className="nav-cart" onClick={() => setMobileOpen(false)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="20" r="1.5" />
              <circle cx="18" cy="20" r="1.5" />
              <path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 2-1.5L23 7H6" />
            </svg>
            Cart
            {count > 0 && <span className="cart-count">{count}</span>}
          </Link>

          {user ? (
            <div className="nav-user" ref={menuRef}>
              <button className="nav-user-btn" onClick={() => setMenuOpen((o) => !o)}>
                <span className="nav-avatar">
                  {user.name.charAt(0).toUpperCase()}
                </span>
                {user.name.split(" ")[0]}
              </button>
              {menuOpen && (
                <div className="nav-menu">
                  <div className="nm-head">
                    <div className="nm-name">{user.name}</div>
                    <div className="nm-role">{user.role.toLowerCase()}</div>
                  </div>
                  {dash && <Link href={dash.href} onClick={() => setMenuOpen(false)}>{dash.label}</Link>}
                  <Link href="/account" onClick={() => setMenuOpen(false)}>My orders</Link>
                  <button onClick={logout}>Sign out</button>
                </div>
              )}
            </div>
          ) : (
            <Link href="/login" onClick={() => setMobileOpen(false)}>Sign in</Link>
          )}
        </div>

        <button
          className="nav-toggle"
          aria-label="Toggle menu"
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
