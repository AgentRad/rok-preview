"use client";

import { useState } from "react";

/**
 * Disclosure button that toggles the catalog filter rail on viewports
 * under 1000px. The CSS rule for `.filters` collapses the rail by default
 * at that breakpoint; this button flips a `.open` class on the aside to
 * reveal it. On desktop the button itself is hidden via `.filter-toggle`
 * + media query in globals.css.
 */
export default function MobileFilterToggle({
  targetId = "catalog-filters",
}: {
  targetId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      className="filter-toggle"
      aria-expanded={open}
      aria-controls={targetId}
      onClick={() => {
        const el = document.getElementById(targetId);
        if (el) el.classList.toggle("open");
        setOpen((o) => !o);
      }}
    >
      {open ? "Hide filters" : "Show filters"}
    </button>
  );
}
