import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-grid">
          <div className="footer-about">
            <Link href="/" className="brand" aria-label="PartsPort home">
              <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
                <path d="M32 10 51.5 21.5v23L32 56 12.5 44.5v-23Z" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinejoin="round" />
                <circle cx="32" cy="32" r="7" fill="#e0a32a" />
              </svg>
              <span className="brand-text">
                <span className="brand-name">PartsPort</span>
              </span>
            </Link>
            <p>
              The industrial parts marketplace. Search, compare, and order from
              vetted suppliers, with delivery handled end to end.
            </p>
          </div>
          <div>
            <h4>Buy</h4>
            <ul>
              <li><Link href="/catalog">Browse catalog</Link></li>
              <li><Link href="/catalog?cat=Transformers">Transformers</Link></li>
              <li><Link href="/how-it-works">How it works</Link></li>
              <li><Link href="/cart">Your cart</Link></li>
            </ul>
          </div>
          <div>
            <h4>Sell</h4>
            <ul>
              <li><Link href="/suppliers">For distributors</Link></li>
              <li><Link href="/manufacturers">For manufacturers</Link></li>
              <li><Link href="/suppliers#apply">Apply now</Link></li>
            </ul>
          </div>
          <div>
            <h4>Account</h4>
            <ul>
              <li><Link href="/login">Sign in</Link></li>
              <li><Link href="/register">Create account</Link></li>
              <li><Link href="/account">My orders</Link></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 PartsPort, Inc. All rights reserved.</span>
          <span>Terms of Service · Privacy Policy · Supplier Agreement</span>
        </div>
      </div>
    </footer>
  );
}
