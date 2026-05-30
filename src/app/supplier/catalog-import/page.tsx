import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canEditCatalog, getActiveSupplierContext } from "@/lib/supplier-access";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import AICatalogImport from "@/components/AICatalogImport";

export const dynamic = "force-dynamic";

export default async function CatalogImportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPPLIER" && user.role !== "ADMIN") redirect("/");
  const ctx = await getActiveSupplierContext(user);
  if (!ctx || !canEditCatalog(ctx.role)) {
    return (
      <>
        <SiteHeader />
        <main id="main" className="app-page">
          <div className="page-pad narrow">
            <h1 className="page-title">Import catalog with AI</h1>
            <div className="alert alert-info" style={{ marginTop: 16 }}>
              Your role does not allow editing the catalog. Ask an OWNER or
              ADMIN to run imports for this supplier.
            </div>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }
  const aiEnabled = Boolean(process.env.ANTHROPIC_API_KEY);
  return (
    <>
      <SiteHeader />
      <main id="main" className="app-page">
        <div className="page-pad">
          <h1 className="page-title">Import catalog with AI</h1>
          <p className="muted-text" style={{ marginTop: 6, maxWidth: 720 }}>
            Paste a CSV, TSV, or Excel clipboard, or upload a .csv or .xlsx
            file. The assistant proposes a mapping from your columns to the
            PartsPort schema. Chat to correct it. Nothing imports until you
            click the button at the bottom.
          </p>
          <AICatalogImport
            aiEnabled={aiEnabled}
            supplierName={ctx.supplier.name}
          />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
