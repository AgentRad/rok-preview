"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Image = { id: string; url: string; position: number };

export default function ImageManager({ productId }: { productId: string }) {
  const router = useRouter();
  const [images, setImages] = useState<Image[]>([]);
  const [url, setUrl] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [showUrl, setShowUrl] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/supplier/products/${productId}/images`)
      .then((r) => r.json())
      .then((data) => setImages(data.images || []))
      .finally(() => setLoaded(true));
  }, [productId]);

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    setUploadError("");
    const form = new FormData();
    for (const f of list) form.append("files", f);
    try {
      const res = await fetch(
        `/api/supplier/products/${productId}/images/upload`,
        { method: "POST", body: form }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUploadError(data.error || "Upload failed.");
        return;
      }
      if (data.images?.length) {
        setImages((list) => [...list, ...data.images]);
      }
      if (data.errors?.length) {
        setUploadError(data.errors.join(" "));
      }
      router.refresh();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function addByUrl() {
    if (!url.trim()) return;
    setUrlBusy(true);
    setUrlError("");
    try {
      const res = await fetch(`/api/supplier/products/${productId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUrlError(data.error || "Could not add the image.");
        return;
      }
      setImages((list) => [...list, data.image]);
      setUrl("");
      router.refresh();
    } finally {
      setUrlBusy(false);
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

  async function persistOrder(next: Image[]) {
    setImages(next);
    await fetch(`/api/supplier/products/${productId}/images/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: next.map((i) => i.id) }),
    });
    router.refresh();
  }

  function setPrimary(idx: number) {
    if (idx === 0) return;
    const next = [...images];
    const [picked] = next.splice(idx, 1);
    next.unshift(picked);
    persistOrder(next);
  }

  function onDragStart(idx: number) {
    return () => setDragIdx(idx);
  }
  function onDragOverItem(idx: number) {
    return (e: React.DragEvent) => {
      e.preventDefault();
      if (dragIdx === null || dragIdx === idx) return;
      const next = [...images];
      const [picked] = next.splice(dragIdx, 1);
      next.splice(idx, 0, picked);
      setDragIdx(idx);
      setImages(next);
    };
  }
  function onDragEnd() {
    if (dragIdx !== null) {
      persistOrder(images);
    }
    setDragIdx(null);
  }

  return (
    <div className="image-manager">
      <div
        className={"image-drop" + (dragOver ? " on" : "")}
        onClick={() => fileInput.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files) uploadFiles(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        aria-label="Upload product images"
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files) uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="image-drop-title">
          {uploading ? "Uploading…" : "Drop images here or click to upload"}
        </div>
        <div className="image-drop-sub">
          JPG, PNG, or WEBP. Max 8 MB each. First image is your primary listing photo.
        </div>
      </div>

      {uploadError && (
        <div className="alert alert-error" style={{ marginTop: 8 }}>
          {uploadError}
        </div>
      )}

      {loaded && images.length === 0 && !uploading && (
        <p className="muted-text" style={{ fontSize: 12.5, marginTop: 12 }}>
          Add the first image so buyers see what they are buying.
        </p>
      )}

      {images.length > 0 && (
        <ul className="image-grid">
          {images.map((img, idx) => (
            <li
              key={img.id}
              className={"image-tile" + (dragIdx === idx ? " dragging" : "")}
              draggable
              onDragStart={onDragStart(idx)}
              onDragOver={onDragOverItem(idx)}
              onDragEnd={onDragEnd}
            >
              <div className="image-tile-thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" />
                {idx === 0 && <span className="image-tile-primary">Primary</span>}
              </div>
              <div className="image-tile-actions">
                {idx !== 0 && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setPrimary(idx)}
                  >
                    Set as primary
                  </button>
                )}
                <button
                  type="button"
                  className="link-btn link-btn-danger"
                  onClick={() => remove(img.id)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="image-url-toggle">
        <button
          type="button"
          className="link-btn"
          onClick={() => setShowUrl((s) => !s)}
        >
          {showUrl ? "Hide URL option" : "Add image by URL"}
        </button>
      </div>
      {showUrl && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="url"
              className="input-sm"
              style={{ flex: 1 }}
              placeholder="https://… hosted image URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={addByUrl}
              disabled={urlBusy || !url.trim()}
            >
              {urlBusy ? "…" : "Add URL"}
            </button>
          </div>
          {urlError && (
            <div className="alert alert-error" style={{ marginTop: 6 }}>
              {urlError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
