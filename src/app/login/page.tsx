import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const showDemoCreds = process.env.VERCEL_ENV !== "production";
  return (
    <>
      <SiteHeader />
      <main id="main">
        <LoginForm showDemoCreds={showDemoCreds} />
      </main>
      <SiteFooter />
    </>
  );
}
