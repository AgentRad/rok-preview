import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ForgotPasswordForm from "@/components/ForgotPasswordForm";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <ForgotPasswordForm />
      </main>
      <SiteFooter />
    </>
  );
}
