import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import CartClient from "@/components/CartClient";

export const dynamic = "force-dynamic";

export default function CartPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <div className="page-pad narrow">
          <h1 className="page-title">Your cart</h1>
          <p className="page-sub">
            Review your parts, then check out. PartsPort handles payment and
            delivery.
          </p>
          <div style={{ marginTop: 24 }}>
            <CartClient />
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
