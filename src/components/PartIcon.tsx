import React from "react";

const PATHS: Record<string, React.ReactNode> = {
  bearing: (
    <>
      <circle cx="32" cy="32" r="22" />
      <circle cx="32" cy="32" r="9" />
      <circle cx="32" cy="11.5" r="3.4" />
      <circle cx="46.5" cy="17.5" r="3.4" />
      <circle cx="52.5" cy="32" r="3.4" />
      <circle cx="46.5" cy="46.5" r="3.4" />
      <circle cx="32" cy="52.5" r="3.4" />
      <circle cx="17.5" cy="46.5" r="3.4" />
      <circle cx="11.5" cy="32" r="3.4" />
      <circle cx="17.5" cy="17.5" r="3.4" />
    </>
  ),
  pump: (
    <>
      <rect x="12" y="20" width="40" height="28" rx="3" />
      <circle cx="26" cy="34" r="8" />
      <circle cx="40" cy="34" r="8" />
      <rect x="28" y="10" width="8" height="10" rx="1" />
      <path d="M12 44h-4M52 44h4" />
    </>
  ),
  cylinder: (
    <>
      <rect x="8" y="24" width="32" height="16" rx="2" />
      <path d="M40 32h12" />
      <rect x="52" y="27" width="5" height="10" rx="1" />
      <path d="M14 24v-5M22 24v-5M30 24v-5" />
    </>
  ),
  motor: (
    <>
      <rect x="12" y="20" width="32" height="26" rx="3" />
      <path d="M44 33h13" />
      <path d="M18 20v26M24 20v26M30 20v26M36 20v26" strokeWidth="1.6" />
      <path d="M16 46v5h6v-5M34 46v5h6v-5" />
    </>
  ),
  contactor: (
    <>
      <rect x="18" y="16" width="28" height="32" rx="2" />
      <path d="M24 16v-6M32 16v-6M40 16v-6M24 48v6M32 48v6M40 48v6" />
      <path d="M24 30h16" strokeWidth="1.6" />
    </>
  ),
  belt: (
    <>
      <circle cx="21" cy="32" r="11" />
      <circle cx="45" cy="32" r="9" />
      <circle cx="21" cy="32" r="3" />
      <circle cx="45" cy="32" r="3" />
      <path d="M21 21h24M21 43h24" />
    </>
  ),
  sensor: (
    <>
      <rect x="9" y="22" width="20" height="20" rx="2" />
      <path d="M29 32h26" strokeDasharray="3 4" />
      <path d="M55 23v18" />
      <path d="M14 22v-4M24 22v-4" />
    </>
  ),
  valve: (
    <>
      <path d="M12 22v20l20-10zM52 22v20L32 32z" />
      <path d="M32 32V14" />
      <ellipse cx="32" cy="12" rx="13" ry="4.5" />
      <path d="M12 32H6M52 32h6" />
    </>
  ),
  bolt: (
    <>
      <path d="M20 19l12 7v12l-12 7-12-7V26z" />
      <path d="M32 27h22v10H32" />
      <path d="M38 27v10M44 27v10M50 27v10" strokeWidth="1.6" />
    </>
  ),
  gear: (
    <>
      <circle cx="32" cy="32" r="14" />
      <circle cx="32" cy="32" r="6" />
      <rect x="29" y="9" width="6" height="9" />
      <rect x="29" y="46" width="6" height="9" />
      <rect x="9" y="29" width="9" height="6" />
      <rect x="46" y="29" width="9" height="6" />
      <rect x="29" y="9" width="6" height="9" transform="rotate(45 32 32)" />
      <rect x="29" y="46" width="6" height="9" transform="rotate(45 32 32)" />
      <rect x="9" y="29" width="9" height="6" transform="rotate(45 32 32)" />
      <rect x="46" y="29" width="9" height="6" transform="rotate(45 32 32)" />
    </>
  ),
  coupling: (
    <>
      <rect x="11" y="18" width="16" height="28" rx="2" />
      <rect x="37" y="18" width="16" height="28" rx="2" />
      <path d="M27 26h10M27 38h10" />
      <path d="M19 18v-4M45 18v-4" />
    </>
  ),
  gasket: (
    <>
      <rect x="10" y="10" width="44" height="44" rx="3" />
      <circle cx="32" cy="32" r="13" />
      <circle cx="18" cy="18" r="2.6" />
      <circle cx="46" cy="18" r="2.6" />
      <circle cx="18" cy="46" r="2.6" />
      <circle cx="46" cy="46" r="2.6" />
    </>
  ),
  insert: (
    <>
      <path d="M32 11l21 21-21 21-21-21z" />
      <circle cx="32" cy="32" r="6" />
    </>
  ),
  hose: (
    <>
      <path d="M12 46C16 18 30 50 36 30s14-6 16-14" />
      <rect x="8" y="42" width="9" height="9" rx="1" />
      <rect x="48" y="11" width="9" height="9" rx="1" />
    </>
  ),
  vfd: (
    <>
      <rect x="14" y="11" width="30" height="42" rx="3" />
      <rect x="20" y="17" width="18" height="9" rx="1" />
      <circle cx="24" cy="38" r="3" />
      <circle cx="34" cy="38" r="3" />
      <path d="M44 18v28M49 18v28M54 18v28" strokeWidth="1.6" />
    </>
  ),
};

export const ICON_KEYS = Object.keys(PATHS);

export default function PartIcon({ icon, className }: { icon: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[icon] ?? PATHS.gear}
    </svg>
  );
}
