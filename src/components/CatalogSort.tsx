"use client";

import { useRouter, useSearchParams } from "next/navigation";

const OPTIONS = [
  { value: "featured", label: "Featured" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
  { value: "eta", label: "Fastest delivery" },
  { value: "rating", label: "Top rated" },
];

export default function CatalogSort({ value }: { value: string }) {
  const router = useRouter();
  const params = useSearchParams();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = new URLSearchParams(params.toString());
    next.set("sort", e.target.value);
    router.push(`/catalog?${next.toString()}`);
  }

  return (
    <div className="row-gap">
      <label htmlFor="sort" style={{ fontSize: 13, color: "var(--steel)" }}>
        Sort
      </label>
      <select id="sort" className="sort-select" value={value} onChange={onChange}>
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
