import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import VerifyEmailPending from "@/components/VerifyEmailPending";

export const dynamic = "force-dynamic";

export default async function VerifyEmailPendingPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const sp = await searchParams;
  const email = typeof sp.email === "string" ? sp.email : "";
  return (
    <>
      <SiteHeader />
      <main id="main">
        <VerifyEmailPending email={email} />
      </main>
      <SiteFooter />
    </>
  );
}
