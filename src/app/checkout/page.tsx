import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import CheckoutClient from "@/components/CheckoutClient";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const user = await getCurrentUser();
  return (
    <>
      <SiteHeader />
      <main id="main">
        <div className="page-pad narrow">
          <h1 className="page-title">Checkout</h1>
          <p className="page-sub">
            One payment to PartsPort — we coordinate the supplier and delivery.
          </p>
          <div style={{ marginTop: 24 }}>
            <CheckoutClient
              user={user ? { name: user.name, email: user.email } : null}
              paypalClientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || ""}
            />
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
