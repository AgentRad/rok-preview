"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function WriteReview({
  productId,
  orderId,
  initialRating = 0,
  initialTitle = "",
  initialBody = "",
  compact = false,
}: {
  productId: string;
  orderId: string;
  initialRating?: number;
  initialTitle?: string;
  initialBody?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(initialRating);
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) {
      setError("Pick a rating from 1 to 5 stars.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, orderId, rating, title, body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not save the review.");
        return;
      }
      setDone(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="alert alert-ok">
        Thank you. Your review is live on this part.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="review-form">
      <div className="review-stars" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={rating === i}
            className={"star-btn" + (i <= rating ? " on" : "")}
            onClick={() => setRating(i)}
          >
            ★
          </button>
        ))}
        <span className="muted-text" style={{ fontSize: 13, marginLeft: 8 }}>
          {rating ? `${rating} / 5` : "Pick a rating"}
        </span>
      </div>
      <div className="form-row" style={{ marginTop: 12 }}>
        <label htmlFor={`rv-title-${productId}-${orderId}`}>
          Title (optional)
        </label>
        <input
          id={`rv-title-${productId}-${orderId}`}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="One line summary"
          maxLength={140}
        />
      </div>
      <div className="form-row" style={{ marginTop: 8 }}>
        <label htmlFor={`rv-body-${productId}-${orderId}`}>
          Your review (optional)
        </label>
        <textarea
          id={`rv-body-${productId}-${orderId}`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="How did the part perform? Was it as described? Any install notes for other buyers?"
          maxLength={4000}
          rows={compact ? 3 : 5}
        />
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <button className="btn btn-primary btn-sm" disabled={busy}>
        {busy ? "Saving…" : initialRating ? "Update review" : "Post review"}
      </button>
    </form>
  );
}
