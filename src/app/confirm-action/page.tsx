import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ConfirmActionForm from "@/components/ConfirmActionForm";

export const dynamic = "force-dynamic";

type Action = "verify" | "recover" | "email-change";

const COPY: Record<Action, { title: string; body: string; label: string }> = {
  verify: {
    title: "Verify your email",
    body: "This will sign you into the account that owns this email. The currently signed-in account will be signed out first.",
    label: "Verify and sign in",
  },
  recover: {
    title: "Recover this account",
    body: "This will sign you into the account being recovered. The currently signed-in account will be signed out first.",
    label: "Recover and sign in",
  },
  "email-change": {
    title: "Confirm new email",
    body: "This will swap the account email and sign you in. The currently signed-in account will be signed out first.",
    label: "Confirm and sign in",
  },
};

const ROUTE: Record<Action, string> = {
  verify: "/api/auth/verify",
  recover: "/api/account/recover",
  "email-change": "/api/account/email-change/confirm",
};

export default async function ConfirmActionPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; action?: string }>;
}) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const action = (typeof sp.action === "string" ? sp.action : "") as Action;
  const valid: Action[] = ["verify", "recover", "email-change"];
  const isValid = valid.includes(action) && !!token;
  return (
    <>
      <SiteHeader />
      <main id="main">
        {isValid ? (
          <ConfirmActionForm
            token={token}
            postUrl={ROUTE[action]}
            title={COPY[action].title}
            body={COPY[action].body}
            label={COPY[action].label}
          />
        ) : (
          <div className="auth-wrap">
            <div className="auth-card">
              <h1>Invalid confirmation link</h1>
              <p className="sub">
                This link is missing required parameters or has expired.
                Please request a fresh email and try again.
              </p>
            </div>
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
