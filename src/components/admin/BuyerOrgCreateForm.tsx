"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function BuyerOrgCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/buyer-orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not create the organization.");
        return;
      }
      setName("");
      router.push(`/admin/buyer-orgs/${data.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <label htmlFor="bo-name" style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
          New organization name
        </label>
        <input
          id="bo-name"
          type="text"
          value={name}
          maxLength={256}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Utilities"
          required
          style={{ width: "100%" }}
        />
      </div>
      <button className="btn btn-primary" disabled={busy || !name.trim()}>
        {busy ? "Creating…" : "Create organization"}
      </button>
      {error && (
        <div className="alert alert-error" style={{ flexBasis: "100%" }}>
          {error}
        </div>
      )}
    </form>
  );
}
