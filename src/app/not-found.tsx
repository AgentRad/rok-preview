import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <div className="notfound">
          <div className="code">404</div>
          <h1>This part isn&rsquo;t in our catalog.</h1>
          <p>The page you tried to reach has moved or never existed.</p>
          <div className="row-gap" style={{ justifyContent: "center" }}>
            <Link href="/" className="btn btn-dark">
              Go home
            </Link>
            <Link href="/catalog" className="btn btn-primary">
              Browse the catalog
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
