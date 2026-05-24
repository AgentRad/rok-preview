import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ResetPasswordForm from "@/components/ResetPasswordForm";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <>
      <SiteHeader />
      <main id="main">
        <ResetPasswordForm token={token || ""} />
      </main>
      <SiteFooter />
    </>
  );
}
