import React from "react";

const PATHS: Record<string, React.ReactNode> = {
  transformer: (
    <>
      <rect x="13" y="26" width="38" height="28" rx="2" />
      <path d="M22 26v-7M32 26v-7M42 26v-7" />
      <circle cx="22" cy="15" r="3.6" />
      <circle cx="32" cy="15" r="3.6" />
      <circle cx="42" cy="15" r="3.6" />
      <path d="M19 54v5M45 54v5" />
    </>
  ),
  breaker: (
    <>
      <rect x="17" y="13" width="30" height="38" rx="2" />
      <circle cx="32" cy="22" r="2.6" />
      <circle cx="32" cy="42" r="2.6" />
      <path d="M32 22l9 17" />
      <path d="M25 13v-5M39 13v-5M25 51v5M39 51v5" />
    </>
  ),
  relay: (
    <>
      <rect x="14" y="14" width="36" height="36" rx="2" />
      <rect x="20" y="20" width="24" height="11" rx="1" />
      <circle cx="23" cy="41" r="2.4" />
      <circle cx="32" cy="41" r="2.4" />
      <circle cx="41" cy="41" r="2.4" />
    </>
  ),
  cable: (
    <>
      <ellipse cx="32" cy="18" rx="20" ry="6" />
      <ellipse cx="32" cy="46" rx="20" ry="6" />
      <path d="M12 18v28M52 18v28" />
      <path d="M20 26h24M20 32h24M20 38h24" strokeWidth="1.7" />
    </>
  ),
  insulator: (
    <>
      <path d="M32 9v46" />
      <circle cx="32" cy="9" r="3.4" />
      <ellipse cx="32" cy="22" rx="13" ry="3.6" />
      <ellipse cx="32" cy="32" rx="13" ry="3.6" />
      <ellipse cx="32" cy="42" rx="13" ry="3.6" />
      <path d="M27 55h10" />
    </>
  ),
  meter: (
    <>
      <rect x="16" y="12" width="32" height="40" rx="3" />
      <circle cx="32" cy="27" r="11" />
      <path d="M32 27l6-5" />
      <path d="M25 44h14" strokeWidth="1.7" />
    </>
  ),
  generator: (
    <>
      <rect x="9" y="22" width="44" height="26" rx="2" />
      <path d="M15 28v14M21 28v14M27 28v14" strokeWidth="1.8" />
      <circle cx="40" cy="35" r="7" />
      <rect x="42" y="11" width="6" height="11" rx="1" />
      <path d="M15 48v5M47 48v5" />
    </>
  ),
  solar: (
    <>
      <rect x="10" y="13" width="44" height="30" rx="1.5" />
      <path d="M24.7 13v30M39.3 13v30M10 23h44M10 33h44" strokeWidth="1.7" />
      <path d="M32 43v11M24 54h16" />
    </>
  ),
  battery: (
    <>
      <rect x="11" y="21" width="38" height="26" rx="2" />
      <rect x="49" y="28" width="5" height="12" rx="1" />
      <path d="M20 27v14M28 27v14M36 27v14" strokeWidth="1.8" />
    </>
  ),
  ground: (
    <>
      <path d="M32 8v26" />
      <circle cx="32" cy="8" r="3.2" />
      <path d="M15 34h34" />
      <path d="M21 42h22" />
      <path d="M26 50h12" />
    </>
  ),
  controller: (
    <>
      <rect x="15" y="20" width="27" height="30" rx="2" />
      <rect x="20" y="25" width="17" height="8" rx="1" />
      <circle cx="22" cy="42" r="2.3" />
      <circle cx="30" cy="42" r="2.3" />
      <path d="M21 20v-4M28.5 20v-4M36 20v-4M21 50v4M28.5 50v4M36 50v4" />
      <path d="M42 24l9-9" />
      <circle cx="52" cy="14" r="2.6" />
    </>
  ),
  shield: (
    <>
      <path d="M32 7l21 7v15c0 13-9 20-21 25-12-5-21-12-21-25V14Z" />
      <path d="M34 21l-9 13h7l-2 10 10-14h-7z" />
    </>
  ),
  part: (
    <>
      <path d="M32 8l20 11v22L32 52 12 41V19Z" />
      <path d="M32 8v44M12 19l20 11 20-11" />
    </>
  ),
};

export const ICON_KEYS = Object.keys(PATHS);

export default function PartIcon({
  icon,
  className,
  label,
}: {
  icon: string;
  className?: string;
  /** Optional accessible name when the icon stands alone. Omit when the icon
   *  sits next to a visible text label (the wrapping element should then
   *  carry aria-hidden on the icon instead). */
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={label || `${icon} icon`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[icon] ?? PATHS.part}
    </svg>
  );
}
