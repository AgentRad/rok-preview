import Link from "next/link";

export default function Brand({ showSub = true }: { showSub?: boolean }) {
  return (
    <Link href="/" className="brand" aria-label="PartsPort home">
      <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
        <path
          d="M32 11 51 22v20L32 53 13 42V22Z"
          fill="none"
          stroke="#f4a51c"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <circle
          cx="32"
          cy="32"
          r="8.5"
          fill="none"
          stroke="#ffffff"
          strokeWidth="5"
        />
      </svg>
      <span className="brand-text">
        <span className="brand-name">PartsPort</span>
        {showSub && <span className="brand-sub">Industrial Marketplace</span>}
      </span>
    </Link>
  );
}
