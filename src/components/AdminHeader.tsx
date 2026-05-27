import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import AdminUserMenu from "./AdminUserMenu";

export default async function AdminHeader() {
  const user = await getCurrentUser();
  return (
    <>
      <div className="admin-topbar">
        <div className="wrap">
          <span>
            <strong>PartsPort Admin</strong> · Operating the marketplace
          </span>
          <span>
            <Link href="/" style={{ color: "inherit", textDecoration: "none" }}>
              View public site &rarr;
            </Link>
          </span>
        </div>
      </div>
      <nav className="admin-nav" aria-label="Admin">
        <div className="admin-nav-inner">
          <Link href="/admin" className="admin-brand">
            PartsPort <span>Admin</span>
          </Link>
          <div className="admin-nav-links">
            <Link href="/admin">Overview</Link>
            <Link href="/admin#suppliers">Suppliers</Link>
            <Link href="/admin#orders">Orders</Link>
            <Link href="/admin#quotes">Quotes</Link>
            <Link href="/admin#returns">Returns</Link>
            <Link href="/admin#invoices">Invoices</Link>
            <Link href="/admin/supplier-health">Supplier health</Link>
            <Link href="/admin/manufacturer-applications">OEM applications</Link>
            <Link href="/admin/integrations/quickbooks">QuickBooks</Link>
            <Link href="/ops">Ops console</Link>
          </div>
          {user && <AdminUserMenu user={{ name: user.name, role: user.role }} />}
        </div>
      </nav>
    </>
  );
}
