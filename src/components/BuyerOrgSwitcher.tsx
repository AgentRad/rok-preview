"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Org = { id: string; name: string };

/**
 * PLH-3y-1: org switcher in the nav. Rendered only when the user belongs to
 * one or more buyer orgs. Selecting an org POSTs to /api/buyer-org/switch,
 * which writes User.activeBuyerOrgId.
 */
export default function BuyerOrgSwitcher({
  orgs,
  activeId,
}: {
  orgs: Org[];
  activeId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const orgId = e.target.value;
    if (!orgId || orgId === activeId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/buyer-org/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      className="buyer-org-switcher"
      aria-label="Active organization"
      value={activeId ?? orgs[0]?.id ?? ""}
      onChange={onChange}
      disabled={busy}
    >
      {orgs.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
