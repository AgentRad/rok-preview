import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <LoginForm />
      </main>
      <SiteFooter />
    </>
  );
}
