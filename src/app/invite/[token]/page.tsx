import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import InviteAccept from "@/components/InviteAccept";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <>
      <SiteHeader />
      <main id="main">
        <InviteAccept token={token} />
      </main>
      <SiteFooter />
    </>
  );
}
