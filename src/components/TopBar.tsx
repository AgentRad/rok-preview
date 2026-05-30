"use client";

import { usePathname } from "next/navigation";

const MARKETING_ROUTES = new Set([
  "/",
  "/how-it-works",
  "/for-suppliers",
  "/for-manufacturers",
]);

export default function TopBar() {
  const pathname = usePathname();
  if (!pathname || !MARKETING_ROUTES.has(pathname)) return null;
  return (
    <div className="topbar">
      <div className="wrap">
        <span>
          Free buyer accounts · Vetted suppliers only · Delivery handled end to end
        </span>
        <span className="muted">
          Are you a supplier? <a href="/suppliers">Apply to sell →</a>
        </span>
      </div>
    </div>
  );
}
