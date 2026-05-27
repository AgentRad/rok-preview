import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { recomputeBrandMismatch } from "@/lib/brand-status";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import AdminHeader from "@/components/AdminHeader";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import TwoFactorSetup from "@/components/TwoFactorSetup";
import ProfileForm from "@/components/ProfileForm";
import AddressBook from "@/components/AddressBook";
import CompanyProfileForm from "@/components/CompanyProfileForm";
import EmailChangeForm from "@/components/EmailChangeForm";
import DeleteAccountForm from "@/components/DeleteAccountForm";
import NotificationPreferencesForm from "@/components/NotificationPreferencesForm";
import { isBlobConfigured } from "@/lib/blob-config";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ emailChange?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const emailChangeFlag = sp.emailChange;
  const isAdmin = user.role === "ADMIN";
  const isBuyer = user.role === "BUYER";

  const addresses = isBuyer
    ? await prisma.address.findMany({
        where: { userId: user.id, deletedAt: null },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      })
    : [];

  // PLH-2 Phase 4d (D1): non-transactional email opt-out flags.
  const prefsRow = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      notifyOrderEmails: true,
      notifyMarketingEmails: true,
      notifyProductUpdates: true,
    },
  });
  const notificationPrefs = prefsRow ?? {
    notifyOrderEmails: true,
    notifyMarketingEmails: true,
    notifyProductUpdates: true,
  };

  const header = isAdmin ? <AdminHeader /> : <SiteHeader />;
  const footer = isAdmin ? null : <SiteFooter />;

  return (
    <>
      {header}
      <main id="main" className="app-page">
        <div className="page-pad narrow">
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">
            Signed in as {user.name} · {user.email} ·{" "}
            {/* Title-case the role enum so "BUYER" doesn't render as "buyer". */}
            {user.role.charAt(0) + user.role.slice(1).toLowerCase()}
          </p>
          {emailChangeFlag === "done" && (
            <div className="alert alert-ok" style={{ marginBottom: 16 }}>
              <strong>Email updated.</strong> Sign-ins and notifications now
              go to {user.email}. The previous address got a confirmation
              note.
            </div>
          )}
          {emailChangeFlag === "expired" && (
            <div className="alert alert-error" style={{ marginBottom: 16 }}>
              <strong>Email-change link expired.</strong> Submit the form
              below again to send a fresh one.
            </div>
          )}
          {emailChangeFlag === "taken" && (
            <div className="alert alert-error" style={{ marginBottom: 16 }}>
              <strong>That email is taken.</strong> Someone else registered
              with the address between your request and your click. Pick a
              different one.
            </div>
          )}
          {emailChangeFlag === "invalid" && (
            <div className="alert alert-error" style={{ marginBottom: 16 }}>
              <strong>Confirmation link was malformed.</strong> Request a
              new one below.
            </div>
          )}

          <div className="card" style={{ marginTop: 24 }}>
            <div className="card-head">
              <h2>Profile</h2>
            </div>
            <div className="card-body">
              {await (async () => {
                const warn = await recomputeBrandMismatch({
                  role: user.role,
                  manufacturerName: user.manufacturerName,
                });
                if (!warn) return null;
                return (
                  <div className="alert alert-info" style={{ marginBottom: 14 }}>
                    <strong>Brand mismatch.</strong> {warn.message}
                  </div>
                );
              })()}
              <ProfileForm
                initialName={user.name}
                email={user.email}
                manufacturerName={user.manufacturerName ?? ""}
                showManufacturerName={user.role === "MANUFACTURER"}
              />
            </div>
          </div>

          <div className="card" style={{ marginTop: 24 }}>
            <div className="card-head">
              <h2>Password</h2>
            </div>
            <div className="card-body">
              <ChangePasswordForm />
            </div>
          </div>

          <div className="card" style={{ marginTop: 24 }}>
            <div className="card-head">
              <h2>Two-factor authentication</h2>
            </div>
            <div className="card-body">
              <TwoFactorSetup
                enabled={!!user.totpEnabledAt}
                enabledAt={
                  user.totpEnabledAt ? user.totpEnabledAt.toISOString() : null
                }
              />
            </div>
          </div>

          {isBuyer && (
            <div className="card" style={{ marginTop: 24 }}>
              <div className="card-head">
                <h2>Company profile</h2>
              </div>
              <div className="card-body">
                <CompanyProfileForm
                  initialName={user.companyName ?? ""}
                  initialLogoUrl={user.companyLogoUrl ?? null}
                  blobConfigured={isBlobConfigured()}
                />
              </div>
            </div>
          )}

          {isBuyer && (
            <div className="card" style={{ marginTop: 24 }}>
              <div className="card-head">
                <h2>Delivery addresses</h2>
              </div>
              <div className="card-body">
                <AddressBook initial={addresses} />
              </div>
            </div>
          )}

          <div className="card" style={{ marginTop: 24 }}>
            <div className="card-head">
              <h2>Notifications</h2>
            </div>
            <div className="card-body">
              <NotificationPreferencesForm initial={notificationPrefs} />
            </div>
          </div>

          <div className="card" style={{ marginTop: 24 }}>
            <div className="card-head">
              <h2>Email address</h2>
            </div>
            <div className="card-body">
              <EmailChangeForm currentEmail={user.email} />
            </div>
          </div>

          {!isAdmin && (
            <div className="card" style={{ marginTop: 24 }}>
              <div className="card-head">
                <h2>Delete account</h2>
              </div>
              <div className="card-body">
                <DeleteAccountForm />
              </div>
            </div>
          )}

          {isBuyer && (
            <p className="muted-text" style={{ fontSize: 13, marginTop: 24 }}>
              Looking for your order history?{" "}
              <Link
                href="/account"
                style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
              >
                Go to My orders &rarr;
              </Link>
            </p>
          )}
        </div>
      </main>
      {footer}
    </>
  );
}
