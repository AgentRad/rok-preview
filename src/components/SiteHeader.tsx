import { getCurrentUser } from "@/lib/auth";
import { getUnreadCounts } from "@/lib/messages";
import HeaderNav from "./HeaderNav";
import TopBar from "./TopBar";
import UnverifiedEmailBanner from "./UnverifiedEmailBanner";

export default async function SiteHeader() {
  const user = await getCurrentUser();
  // In-nav parts-search speaks to buyers. Suppliers, manufacturers, and
  // admins land on their dashboards and don't need a parts search bar.
  // The marketing top bar is restricted to marketing routes only via TopBar.
  const isBuyerContext = !user || user.role === "BUYER";
  // PLH-3p F4: badge the dashboard link with the user's total unread
  // thread messages. Manufacturers/OEMs don't transact through threads
  // so skip the query for them.
  let dashboardUnread = 0;
  let directUnread = 0;
  if (user && user.role !== "MANUFACTURER") {
    const counts = await getUnreadCounts(user.id);
    dashboardUnread = counts.orderUnread + counts.quoteUnread;
    directUnread = counts.directUnread;
  }
  return (
    <>
      {isBuyerContext && <TopBar />}
      <HeaderNav
        user={user ? { name: user.name, role: user.role } : null}
        showSearch={isBuyerContext}
        unreadCount={dashboardUnread}
        directUnread={directUnread}
      />
      {user && !user.emailVerified && (
        <UnverifiedEmailBanner email={user.email} />
      )}
    </>
  );
}
