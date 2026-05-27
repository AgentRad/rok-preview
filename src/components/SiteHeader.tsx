import { getCurrentUser } from "@/lib/auth";
import HeaderNav from "./HeaderNav";
import TopBar from "./TopBar";
import UnverifiedEmailBanner from "./UnverifiedEmailBanner";

export default async function SiteHeader() {
  const user = await getCurrentUser();
  // In-nav parts-search speaks to buyers. Suppliers, manufacturers, and
  // admins land on their dashboards and don't need a parts search bar.
  // The marketing top bar is restricted to marketing routes only via TopBar.
  const isBuyerContext = !user || user.role === "BUYER";
  return (
    <>
      {isBuyerContext && <TopBar />}
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
