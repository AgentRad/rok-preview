import { getCurrentUser } from "@/lib/auth";
import HeaderNav from "./HeaderNav";
import UnverifiedEmailBanner from "./UnverifiedEmailBanner";

export default async function SiteHeader() {
  const user = await getCurrentUser();
  // The topbar marketing line and the in-nav parts-search both speak to
  // buyers. Suppliers, manufacturers, and admins land on their dashboards
  // and don't need to be told they could "Apply to sell" or pointed at a
  // parts search bar. Hide both when the viewer isn't an anonymous browser
  // or a buyer.
  const isBuyerContext = !user || user.role === "BUYER";
  return (
    <>
      {isBuyerContext && (
        <div className="topbar">
          <div className="wrap">
            <span>
              Free buyer accounts · Vetted suppliers only · Delivery handled end to end
            </span>
            <span className="muted">
              Are you a supplier? <a href="/suppliers">Apply to sell →</a>
            </span>
          </div>
        </div>
      )}
      <HeaderNav
        user={user ? { name: user.name, role: user.role } : null}
        showSearch={isBuyerContext}
      />
      {user && !user.emailVerified && (
        <UnverifiedEmailBanner email={user.email} />
      )}
    </>
  );
}
