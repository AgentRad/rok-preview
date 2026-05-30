import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import RegisterForm from "@/components/RegisterForm";

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <RegisterForm />
      </main>
      <SiteFooter />
    </>
  );
}
