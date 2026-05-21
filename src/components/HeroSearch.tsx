"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ProductImage from "./ProductImage";
import { formatCents } from "@/lib/money";

type Result = {
  sku: string;
  name: string;
  manufacturer: string;
  category: string;
  icon: string;
  imageUrl?: string | null;
  priceCents: number;
  unit: string;
  quoteOnly: boolean;
};

export default function HeroSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setOpen(true);
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        const data = await res.json();
        setResults(data.products || []);
      } catch {
        setResults([]);
      }
      setLoading(false);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (term) router.push(`/catalog?q=${encodeURIComponent(term)}`);
  }

  return (
    <div className="hero-search-wrap" ref={wrapRef}>
      <form className="hero-search" onSubmit={submit} role="search">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => q.trim().length >= 2 && setOpen(true)}
          placeholder="Search for any part — name, spec, or describe what you need"
          aria-label="Search for a part"
        />
        <button type="submit">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          Search
        </button>
      </form>

      {open && (
        <div className="hs-results">
          {loading && results.length === 0 && (
            <div className="hs-msg">Searching…</div>
          )}
          {!loading && results.length === 0 && (
            <div className="hs-msg">No matches — try describing it differently.</div>
          )}
          {results.map((r) => (
            <Link key={r.sku} href={`/product/${r.sku}`} className="hs-row">
              <span className="hs-thumb">
                <ProductImage imageUrl={r.imageUrl} icon={r.icon} name={r.name} />
              </span>
              <span className="hs-info">
                <span className="hs-name">{r.name}</span>
                <span className="hs-meta">
                  {r.manufacturer} · {r.category}
                </span>
              </span>
              <span className="hs-price">
                {formatCents(r.priceCents)}
                {r.quoteOnly && <span className="hs-quote"> · by quote</span>}
              </span>
            </Link>
          ))}
          {results.length > 0 && (
            <Link
              href={`/catalog?q=${encodeURIComponent(q.trim())}`}
              className="hs-all"
            >
              See all results for &ldquo;{q.trim()}&rdquo; →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
