"use client";

import Image from "next/image";
import { useState } from "react";

type GalleryImage = { id: string; url: string };

export default function ProductGallery({
  images,
  name,
}: {
  images: GalleryImage[];
  name: string;
}) {
  const [active, setActive] = useState(0);
  if (images.length === 0) return null;
  const main = images[Math.min(active, images.length - 1)];

  function step(dir: 1 | -1) {
    setActive((i) => (i + dir + images.length) % images.length);
  }

  return (
    <div className="gallery">
      <div
        className="gallery-main"
        role="img"
        aria-label={name}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") step(1);
          if (e.key === "ArrowLeft") step(-1);
        }}
        tabIndex={0}
      >
        <Image
          src={main.url}
          alt={name}
          className="pi-photo"
          width={1200}
          height={1200}
          sizes="(max-width: 768px) 100vw, 800px"
          priority
        />
      </div>
      {images.length > 1 && (
        <div className="gallery-thumbs" role="tablist" aria-label="Product images">
          {images.map((img, idx) => (
            <button
              key={img.id}
              type="button"
              role="tab"
              aria-selected={idx === active}
              aria-label={`View image ${idx + 1} of ${images.length}`}
              className={"gallery-thumb" + (idx === active ? " on" : "")}
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
      )}
    </div>
  );
}
