import { getCurrentUser } from "@/lib/auth";
import { getUnreadCounts } from "@/lib/messages";
import { listBuyerOrgsForUser, getActiveBuyerOrgContext } from "@/lib/buyer-org-access";
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
  // order/quote messages. PLH-3q P6: also badge the /messages link with
  // direct-message unread for every signed-in role, OEMs included (they
  // can be DM participants even though they have no order/quote threads).
  let dashboardUnread = 0;
  let directUnread = 0;
  // PLH-3y-1: buyer org switcher data. Only rendered when the user belongs to
  // one or more orgs.
  let buyerOrgs: { id: string; name: string }[] = [];
  let activeBuyerOrgId: string | null = null;
  if (user) {
    const counts = await getUnreadCounts(user.id);
    dashboardUnread = counts.orderUnread + counts.quoteUnread;
    directUnread = counts.directUnread;
    const orgs = await listBuyerOrgsForUser(user.id);
    if (orgs.length > 0) {
      buyerOrgs = orgs.map((o) => ({ id: o.org.id, name: o.org.name }));
      const active = await getActiveBuyerOrgContext(user);
      activeBuyerOrgId = active?.org.id ?? null;
    }
  }
  return (
    <>
      {isBuyerContext && <TopBar />}
      <HeaderNav
        user={user ? { name: user.name, role: user.role } : null}
        showSearch={isBuyerContext}
        unreadCount={dashboardUnread}
        directUnread={directUnread}
        buyerOrgs={buyerOrgs}
        activeBuyerOrgId={activeBuyerOrgId}
      />
      {user && !user.emailVerified && (
        <UnverifiedEmailBanner email={user.email} />
      )}
    </>
  );
}
