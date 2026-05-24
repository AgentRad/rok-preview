"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Image = { id: string; url: string; position: number };

export default function ImageManager({ productId }: { productId: string }) {
  const router = useRouter();
  const [images, setImages] = useState<Image[]>([]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/supplier/products/${productId}/images`)
      .then((r) => r.json())
      .then((data) => setImages(data.images || []))
      .finally(() => setLoaded(true));
  }, [productId]);

  async function add() {
    if (!url.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/supplier/products/${productId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not add the image.");
        return;
      }
      setImages((list) => [...list, data.image]);
      setUrl("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(imageId: string) {
    const res = await fetch(`/api/supplier/products/${productId}/images`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageId }),
    });
    if (res.ok) {
      setImages((list) => list.filter((i) => i.id !== imageId));
      router.refresh();
    }
  }

  return (
    <div className="image-manager">
      {loaded && images.length === 0 && (
        <p className="muted-text" style={{ fontSize: 12.5 }}>
          No gallery images yet. Add hosted image URLs below; the first one is
          shown as the listing photo.
        </p>
      )}
      {images.map((img) => (
        <div key={img.id} className="img-row">
          <div className="img-thumb">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt="" />
          </div>
          <span className="img-url">{img.url}</span>
          <button
            type="button"
            className="link-btn link-btn-danger"
            onClick={() => remove(img.id)}
          >
            Remove
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="url"
          className="input-sm"
          style={{ flex: 1 }}
          placeholder="https://… image URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={add}
          disabled={busy || !url.trim()}
        >
          {busy ? "…" : "Add"}
        </button>
      </div>
      {error && (
        <div className="alert alert-error" style={{ marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}
