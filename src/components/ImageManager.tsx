"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Image = { id: string; url: string; ordinal: number; alt: string };

const MAX_IMAGES = 12;

export default function ImageManager({ productId }: { productId: string }) {
  const router = useRouter();
  const [images, setImages] = useState<Image[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlError, setUrlError] = useState("");

  // Local edits to alt text. Keyed by image id so each input is
  // controlled independently; persisted on blur.
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch(`/api/supplier/products/${productId}/images`)
      .then((r) => r.json())
      .then((data) => {
        const imgs: Image[] = (data.images || []).map((i: Image) => ({
          ...i,
          alt: i.alt ?? "",
        }));
        setImages(imgs);
        const drafts: Record<string, string> = {};
        for (const i of imgs) drafts[i.id] = i.alt;
        setAltDrafts(drafts);
      })
      .finally(() => setLoaded(true));
  }, [productId]);

  const atCap = images.length >= MAX_IMAGES;
  const remainingSlots = Math.max(0, MAX_IMAGES - images.length);

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    if (atCap) {
      setUploadError(`Max ${MAX_IMAGES} images per product. Delete one first.`);
      return;
    }
    setUploading(true);
    setUploadError("");
    const errors: string[] = [];

    // Sequential upload with per-file progress. One request per file so
    // a bad file (oversize, bad MIME) does not block the rest of the batch.
    let added = 0;
    for (let i = 0; i < list.length; i++) {
      if (images.length + added >= MAX_IMAGES) {
        errors.push(`${list[i].name}: skipped (12-image cap reached).`);
        continue;
      }
      setUploadStatus(`Uploading ${i + 1} of ${list.length}: ${list[i].name}`);
      const form = new FormData();
      form.append("files", list[i]);
      try {
        const res = await fetch(
          `/api/supplier/products/${productId}/images/upload`,
          { method: "POST", body: form }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          errors.push(`${list[i].name}: ${data.error || "Upload failed."}`);
          continue;
        }
        if (data.errors?.length) {
          errors.push(...data.errors);
        }
        if (data.images?.length) {
          const fresh = (data.images as Image[]).map((img) => ({
            ...img,
            alt: img.alt ?? "",
          }));
          setImages((prev) => [...prev, ...fresh]);
          setAltDrafts((prev) => {
            const next = { ...prev };
            for (const img of fresh) next[img.id] = img.alt;
            return next;
          });
          added += fresh.length;
        }
      } catch (e) {
        errors.push(
          `${list[i].name}: ${e instanceof Error ? e.message : "Upload failed."}`
        );
      }
    }
    setUploadStatus("");
    setUploading(false);
    if (errors.length) setUploadError(errors.join(" "));
    router.refresh();
  }

  async function addByUrl() {
    if (!url.trim()) return;
    if (atCap) {
      setUrlError(`Max ${MAX_IMAGES} images per product.`);
      return;
    }
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
      const img: Image = { ...data.image, alt: data.image.alt ?? "" };
      setImages((list) => [...list, img]);
      setAltDrafts((prev) => ({ ...prev, [img.id]: img.alt }));
      setUrl("");
      router.refresh();
    } finally {
      setUrlBusy(false);
    }
  }

  async function remove(imageId: string) {
    if (typeof window !== "undefined") {
      const ok = window.confirm("Delete this image?");
      if (!ok) return;
    }
    const res = await fetch(
      `/api/supplier/products/${productId}/images/${imageId}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      setImages((list) => list.filter((i) => i.id !== imageId));
      setAltDrafts((prev) => {
        const next = { ...prev };
        delete next[imageId];
        return next;
      });
      router.refresh();
    }
  }

  async function persistReorder(next: Image[]) {
    setImages(next);
    await fetch(`/api/supplier/products/${productId}/images/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: next.map((i) => i.id) }),
    });
    router.refresh();
  }

  async function setPrimary(imageId: string) {
    const res = await fetch(
      `/api/supplier/products/${productId}/images/${imageId}/primary`,
      { method: "POST" }
    );
    if (res.ok) {
      // Mirror the server-side reorder locally: target to ordinal 0,
      // shift the rest up.
      setImages((prev) => {
        const target = prev.find((i) => i.id === imageId);
        if (!target) return prev;
        const rest = prev.filter((i) => i.id !== imageId);
        return [target, ...rest].map((img, idx) => ({ ...img, ordinal: idx }));
      });
      router.refresh();
    }
  }

  async function saveAlt(imageId: string) {
    const value = altDrafts[imageId] ?? "";
    const current = images.find((i) => i.id === imageId);
    if (!current) return;
    if (value.trim() === current.alt) return;
    const res = await fetch(
      `/api/supplier/products/${productId}/images/${imageId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alt: value }),
      }
    );
    if (res.ok) {
      setImages((prev) =>
        prev.map((i) =>
          i.id === imageId ? { ...i, alt: value.trim().slice(0, 200) } : i
        )
      );
    }
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
      persistReorder(images);
    }
    setDragIdx(null);
  }

  return (
    <div className="image-manager">
      {atCap && (
        <div
          className="alert"
          style={{ marginBottom: 8, fontSize: 12.5 }}
        >
          You have {MAX_IMAGES} images on this product, the maximum. Delete
          one to add another.
        </div>
      )}

      <div
        className={"image-drop" + (dragOver ? " on" : "") + (atCap ? " disabled" : "")}
        onClick={() => {
          if (atCap) return;
          fileInput.current?.click();
        }}
        onDragEnter={(e) => {
          if (atCap) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          if (atCap) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (atCap) return;
          if (e.dataTransfer.files) uploadFiles(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={atCap ? -1 : 0}
        aria-disabled={atCap}
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
          {uploading
            ? uploadStatus || "Uploading..."
            : atCap
            ? "Image limit reached"
            : "Drop images here or click to upload"}
        </div>
        <div className="image-drop-sub">
          PNG, JPEG, or WEBP. Max 5 MB each. Up to {MAX_IMAGES} per product.
          First image is the primary listing photo.
          {!atCap && remainingSlots < MAX_IMAGES && (
            <> {remainingSlots} slot{remainingSlots === 1 ? "" : "s"} left.</>
          )}
        </div>
      </div>

      {uploadError && (
        <div className="alert alert-error" style={{ marginTop: 8 }}>
          {uploadError}
        </div>
      )}

      {loaded && images.length === 0 && !uploading && (
        <p className="muted-text" style={{ fontSize: 12.5, marginTop: 12 }}>
          Add at least one product photo. Buyers see these on every product page.
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
                <img src={img.url} alt={img.alt || ""} />
                {idx === 0 && <span className="image-tile-primary">Primary</span>}
              </div>
              <div className="image-tile-actions">
                {idx !== 0 && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setPrimary(img.id)}
                    title="Set as primary"
                  >
                    Set as primary
                  </button>
                )}
                <button
                  type="button"
                  className="link-btn link-btn-danger"
                  onClick={() => remove(img.id)}
                  title="Delete image"
                >
                  Delete
                </button>
              </div>
              {idx === 0 && (
                <div style={{ marginTop: 6 }}>
                  <input
                    type="text"
                    className="input-sm"
                    style={{ width: "100%", fontSize: 12 }}
                    placeholder="Alt text for accessibility (optional)"
                    maxLength={200}
                    value={altDrafts[img.id] ?? ""}
                    onChange={(e) =>
                      setAltDrafts((prev) => ({
                        ...prev,
                        [img.id]: e.target.value,
                      }))
                    }
                    onBlur={() => saveAlt(img.id)}
                  />
                </div>
              )}
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
              placeholder="https://... hosted image URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={atCap}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={addByUrl}
              disabled={urlBusy || !url.trim() || atCap}
            >
              {urlBusy ? "..." : "Add URL"}
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
