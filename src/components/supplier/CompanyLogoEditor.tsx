import SupplierLogoUploader from "@/components/SupplierLogoUploader";

// PLH-3l P2: extracted from /supplier/page.tsx Profile card.
export default function CompanyLogoEditor({
  logoUrl,
  supplierName,
  blobConfigured,
}: {
  logoUrl: string | null;
  supplierName: string;
  blobConfigured: boolean;
}) {
  return (
    <div id="profile" className="card">
      <div className="card-head">
        <h2>Profile</h2>
      </div>
      <div className="card-body">
        <SupplierLogoUploader
          initialLogoUrl={logoUrl}
          supplierName={supplierName}
          blobConfigured={blobConfigured}
        />
      </div>
    </div>
  );
}
