import Link from "next/link";

export default function Brand({ showSub = true }: { showSub?: boolean }) {
  return (
    <Link href="/" className="brand" aria-label="PartsPort home">
      <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
        <path
          d="M32 10 51.5 21.5v23L32 56 12.5 44.5v-23Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.4"
          strokeLinejoin="round"
        />
        <circle cx="32" cy="32" r="7" fill="#e0a32a" />
      </svg>
      <span className="brand-text">
        <span className="brand-name">PartsPort</span>
        {showSub && <span className="brand-sub">Industrial Marketplace</span>}
      </span>
    </Link>
  );
}
