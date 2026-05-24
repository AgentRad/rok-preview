"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Action = "approve" | "reject" | "resolve";

export default function ReturnActions({ returnId }: { returnId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function run(action: Action) {
    setBusy(true);
    try {
      const res = await fetch(`/api/returns/${returnId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="return-actions">
      <input
        type="text"
        className="input-sm"
        placeholder="Internal note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="row-gap" style={{ marginTop: 6 }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => run("approve")}
          disabled={busy}
        >
          Approve
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => run("reject")}
          disabled={busy}
        >
          Reject
        </button>
        <button
          type="button"
          className="btn btn-dark btn-sm"
          onClick={() => run("resolve")}
          disabled={busy}
        >
          Resolve
        </button>
      </div>
    </div>
  );
}
