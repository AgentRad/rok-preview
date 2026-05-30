import AdminHeader from "@/components/AdminHeader";
// Scopes the admin shell + profit + audit-log CSS to /admin routes only.
import "./admin.css";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="admin-shell">
      <AdminHeader />
      {children}
    </div>
  );
}
