"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type NavUser = { name: string; role: string };

export default function AdminUserMenu({ user }: { user: NavUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setOpen(false);
    router.push("/");
    router.refresh();
  }

  return (
    <div className="admin-user" ref={ref}>
      <button
        type="button"
        className="admin-user-btn"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="admin-avatar">
          {user.name.charAt(0).toUpperCase()}
        </span>
        <span className="admin-user-meta">
          <span className="admin-user-name">{user.name}</span>
          <span className="admin-user-role">{user.role.toLowerCase()}</span>
        </span>
      </button>
      {open && (
        <div className="admin-menu">
          <Link href="/settings" onClick={() => setOpen(false)}>
            Settings
          </Link>
          <Link href="/" onClick={() => setOpen(false)}>
            Public site
          </Link>
          <button onClick={logout}>Sign out</button>
        </div>
      )}
    </div>
  );
}
