import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import CheckoutClient from "@/components/CheckoutClient";
import { getCurrentUser } from "@/lib/auth";
import { isPaymentsConfigured } from "@/lib/payments";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const user = await getCurrentUser();
  // OEMs and suppliers cannot buy through the platform. Redirect to their
  // dashboards rather than show a checkout that would never be valid.
  if (user?.role === "MANUFACTURER") redirect("/oem");
  if (user?.role === "SUPPLIER") redirect("/supplier");
  return (
    <>
      <SiteHeader />
      <main id="main" className="app-page">
        <div className="page-pad narrow">
          <h1 className="page-title">Checkout</h1>
          <p className="page-sub">
            One payment to PartsPort. We coordinate the supplier and delivery.
          </p>
          <div style={{ marginTop: 24 }}>
            <CheckoutClient
              user={user ? { name: user.name, email: user.email } : null}
              paypalClientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || ""}
              paymentsConfigured={isPaymentsConfigured()}
            />
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
