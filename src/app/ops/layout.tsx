import AdminHeader from "@/components/AdminHeader";

export default function OpsLayout({
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
