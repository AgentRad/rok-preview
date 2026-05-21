"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = { sku: string; user: { name: string; email: string } | null };

export default function RequestQuote({ sku, user }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: user?.name || "",
    email: user?.email || "",
    company: "",
    qty: "1",
    message: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku, ...form, qty: Number(form.qty) }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not submit your request.");
      return;
    }
    router.push(`/quotes/${data.quoteId}`);
  }

  if (!open) {
    return (
      <div>
        <button className="btn btn-primary btn-block" onClick={() => setOpen(true)}>
          Request a quote
        </button>
        <p className="muted-text" style={{ fontSize: 12.5, marginTop: 10 }}>
          Configured, made-to-order equipment. A vetted supplier prices it and
          responds — typically within one business day.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="form-row two">
        <div>
          <label htmlFor="rq-name">Name</label>
          <input id="rq-name" value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </div>
        <div>
          <label htmlFor="rq-email">Work email</label>
          <input id="rq-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
        </div>
      </div>
      <div className="form-row two">
        <div>
          <label htmlFor="rq-company">Company</label>
          <input id="rq-company" value={form.company} onChange={(e) => set("company", e.target.value)} />
        </div>
        <div>
          <label htmlFor="rq-qty">Quantity</label>
          <input id="rq-qty" type="number" min="1" value={form.qty} onChange={(e) => set("qty", e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="rq-msg">Project details</label>
        <textarea
          id="rq-msg"
          value={form.message}
          onChange={(e) => set("message", e.target.value)}
          placeholder="Configuration, specs, delivery location, required date…"
        />
      </div>
      <button className="btn btn-primary btn-block" disabled={busy}>
        {busy ? "Submitting…" : "Submit quote request"}
      </button>
    </form>
  );
}
