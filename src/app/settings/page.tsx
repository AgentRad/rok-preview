import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import AdminHeader from "@/components/AdminHeader";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import TwoFactorSetup from "@/components/TwoFactorSetup";
import ProfileForm from "@/components/ProfileForm";
import AddressBook from "@/components/AddressBook";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const isBuyer = user.role === "BUYER";

  const addresses = isBuyer
    ? await prisma.address.findMany({
        where: { userId: user.id },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      })
    : [];

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

          <div className="card" style={{ marginTop: 24 }}>
            <div className="card-head">
              <h2>Profile</h2>
            </div>
            <div className="card-body">
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
                <h2>Delivery addresses</h2>
              </div>
              <div className="card-body">
                <AddressBook initial={addresses} />
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
