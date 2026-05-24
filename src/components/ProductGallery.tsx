"use client";

import { useState } from "react";

type Image = { id: string; url: string };

export default function ProductGallery({
  images,
  name,
}: {
  images: Image[];
  name: string;
}) {
  const [active, setActive] = useState(0);
  if (images.length === 0) return null;
  const main = images[Math.min(active, images.length - 1)];

  return (
    <div className="gallery">
      <div className="gallery-main">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={main.url} alt={name} className="pi-photo" />
      </div>
      {images.length > 1 && (
        <div className="gallery-thumbs" role="tablist">
          {images.map((img, idx) => (
            <button
              key={img.id}
              type="button"
              role="tab"
              aria-selected={idx === active}
              className={"gallery-thumb" + (idx === active ? " on" : "")}
              onClick={() => setActive(idx)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={`${name} view ${idx + 1}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
