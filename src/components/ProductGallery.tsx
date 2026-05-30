"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";

type GalleryImage = { id: string; url: string; alt?: string | null };

export default function ProductGallery({
  images,
  name,
}: {
  images: GalleryImage[];
  name: string;
}) {
  const [active, setActive] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const count = images.length;
  const safeIndex = count > 0 ? Math.min(active, count - 1) : 0;
  const main = count > 0 ? images[safeIndex] : null;

  const step = useCallback(
    (dir: 1 | -1) => {
      if (count <= 1) return;
      setActive((i) => (i + dir + count) % count);
    },
    [count]
  );

  const altFor = useCallback(
    (img: GalleryImage, idx: number) => {
      const a = (img.alt || "").trim();
      if (a) return a;
      return `${name} (image ${idx + 1} of ${count})`;
    },
    [name, count]
  );

  // Global key handler when the lightbox is open: arrows + ESC.
  useEffect(() => {
    if (!lightboxOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setLightboxOpen(false);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      }
    }
    window.addEventListener("keydown", onKey);
    // Lock background scroll while the overlay is up.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightboxOpen, step]);

  if (count === 0 || !main) return null;

  // Single-image layout: photo only, click to open lightbox. No
  // thumbnail strip, no prev/next chrome.
  if (count === 1) {
    return (
      <>
        <div className="gallery gallery-single">
          <button
            type="button"
            className="gallery-main gallery-main-trigger"
            onClick={() => setLightboxOpen(true)}
            aria-label="Open full-size image"
          >
            <Image
              src={main.url}
              alt={altFor(main, 0)}
              className="pi-photo"
              width={1200}
              height={1200}
              sizes="(max-width: 768px) 100vw, 800px"
              priority
            />
          </button>
        </div>
        {lightboxOpen && (
          <Lightbox
            images={images}
            index={safeIndex}
            altFor={altFor}
            onClose={() => setLightboxOpen(false)}
            onStep={step}
          />
        )}
      </>
    );
  }

  // 2+ images: full carousel with arrows + thumb strip + lightbox.
  return (
    <>
      <div
        className="gallery"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            step(1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            step(-1);
          }
        }}
      >
        <div className="gallery-main-wrap">
          <button
            type="button"
            className="gallery-main gallery-main-trigger"
            onClick={() => setLightboxOpen(true)}
            aria-label={`Open full-size image. Showing image ${safeIndex + 1} of ${count}.`}
          >
            <Image
              src={main.url}
              alt={altFor(main, safeIndex)}
              className="pi-photo"
              width={1200}
              height={1200}
              sizes="(max-width: 768px) 100vw, 800px"
              priority
            />
          </button>
          <button
            type="button"
            className="gallery-arrow gallery-arrow-prev"
            aria-label="Previous image"
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            className="gallery-arrow gallery-arrow-next"
            aria-label="Next image"
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
          >
            <span aria-hidden="true">›</span>
          </button>
          <span className="gallery-counter" aria-hidden="true">
            {safeIndex + 1} / {count}
          </span>
        </div>
        <div className="gallery-thumbs" role="tablist" aria-label="Product images">
          {images.map((img, idx) => (
            <button
              key={img.id}
              type="button"
              role="tab"
              aria-selected={idx === safeIndex}
              aria-label={`View image ${idx + 1} of ${count}`}
              className={"gallery-thumb" + (idx === safeIndex ? " on" : "")}
              onClick={() => setActive(idx)}
            >
              <Image
                src={img.url}
                alt=""
                width={160}
                height={160}
                sizes="120px"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      </div>
      {lightboxOpen && (
        <Lightbox
          images={images}
          index={safeIndex}
          altFor={altFor}
          onClose={() => setLightboxOpen(false)}
          onStep={step}
        />
      )}
    </>
  );
}

function Lightbox({
  images,
  index,
  altFor,
  onClose,
  onStep,
}: {
  images: GalleryImage[];
  index: number;
  altFor: (img: GalleryImage, idx: number) => string;
  onClose: () => void;
  onStep: (dir: 1 | -1) => void;
}) {
  const count = images.length;
  const current = images[index];
  if (!current) return null;
  return (
    <div
      className="lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onClick={onClose}
    >
      <button
        type="button"
        className="lightbox-close"
        aria-label="Close image viewer"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <span aria-hidden="true">×</span>
      </button>
      {count > 1 && (
        <>
          <button
            type="button"
            className="lightbox-arrow lightbox-arrow-prev"
            aria-label="Previous image"
            onClick={(e) => {
              e.stopPropagation();
              onStep(-1);
            }}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            className="lightbox-arrow lightbox-arrow-next"
            aria-label="Next image"
            onClick={(e) => {
              e.stopPropagation();
              onStep(1);
            }}
          >
            <span aria-hidden="true">›</span>
          </button>
        </>
      )}
      <div className="lightbox-stage" onClick={(e) => e.stopPropagation()}>
        <Image
          src={current.url}
          alt={altFor(current, index)}
          className="lightbox-img"
          width={1800}
          height={1800}
          sizes="100vw"
          priority
        />
        {count > 1 && (
          <div className="lightbox-counter" aria-hidden="true">
            {index + 1} / {count}
          </div>
        )}
      </div>
    </div>
  );
}
