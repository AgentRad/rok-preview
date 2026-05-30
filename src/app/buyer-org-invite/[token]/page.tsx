import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import BuyerOrgInviteAccept from "@/components/BuyerOrgInviteAccept";

export const dynamic = "force-dynamic";

export default async function BuyerOrgInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <>
      <SiteHeader />
      <main id="main">
        <BuyerOrgInviteAccept token={token} />
      </main>
      <SiteFooter />
    </>
  );
}
