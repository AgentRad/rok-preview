"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ActingAsBanner({ supplierName }: { supplierName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function stop() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/acting-as", { method: "DELETE" });
      if (res.ok) {
        router.push("/admin");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="acting-banner">
      <div>
        <strong>Admin override.</strong> You are acting as{" "}
        <strong>{supplierName}</strong>. Everything you change here is recorded
        as if their owner did it.
      </div>
      <button
        type="button"
        className="btn btn-dark btn-sm"
        onClick={stop}
        disabled={busy}
      >
        {busy ? "Stopping…" : "Stop and return to /admin"}
      </button>
    </div>
  );
}
