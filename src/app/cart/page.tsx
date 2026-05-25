import Link from "next/link";
import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import CartClient from "@/components/CartClient";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CartPage() {
  // OEMs and suppliers don't shop here. Send them to their dashboards.
  // Buyers (logged-in or anonymous) get the normal cart.
  const user = await getCurrentUser();
  if (user?.role === "MANUFACTURER") redirect("/oem");
  if (user?.role === "SUPPLIER") redirect("/supplier");
  return (
    <>
      <SiteHeader />
      <main id="main" className="app-page">
        <div className="page-pad narrow">
          <h1 className="page-title">Your cart</h1>
          <p className="page-sub">
            Review your parts, then check out. PartsPort handles payment and
            delivery.
          </p>
          <div style={{ marginTop: 24 }}>
            <CartClient />
            {/* Crawlers and JS-disabled visitors get a real empty state
                instead of the "Loading..." spinner that the cart shows
                while it hydrates from localStorage. */}
            <noscript>
              <div className="empty-state" style={{ marginTop: 0 }}>
                <h3>Your cart is empty.</h3>
                <p>
                  PartsPort uses your browser to remember items before
                  checkout. Turn on JavaScript or start browsing the
                  catalog.
                </p>
                <Link href="/catalog" className="btn btn-primary">
                  Browse catalog
                </Link>
              </div>
            </noscript>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
