import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-grid">
          <div className="footer-about">
            <Link href="/" className="brand" aria-label="PartsPort home">
              <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
                <path d="M32 11 51 22v20L32 53 13 42V22Z" fill="none" stroke="#f4a51c" strokeWidth="5" strokeLinejoin="round" />
                <circle cx="32" cy="32" r="8.5" fill="none" stroke="#ffffff" strokeWidth="5" />
              </svg>
              <span className="brand-text">
                <span className="brand-name">PartsPort</span>
              </span>
            </Link>
            <p>
              The industrial parts marketplace. Search, compare, and order from
              vetted suppliers — with delivery handled end to end.
            </p>
          </div>
          <div>
            <h4>Buy</h4>
            <ul>
              <li><Link href="/catalog">Browse catalog</Link></li>
              <li><Link href="/catalog?cat=Bearings">Bearings</Link></li>
              <li><Link href="/catalog?cat=Hydraulics">Hydraulics</Link></li>
              <li><Link href="/cart">Your cart</Link></li>
            </ul>
          </div>
          <div>
            <h4>Sell</h4>
            <ul>
              <li><Link href="/suppliers">Become a supplier</Link></li>
              <li><Link href="/suppliers#criteria">Qualification criteria</Link></li>
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
          <span>© 2026 PartsPort. Placeholder brand — demo marketplace.</span>
          <span>Terms · Privacy · Supplier Agreement</span>
        </div>
      </div>
    </footer>
  );
}
