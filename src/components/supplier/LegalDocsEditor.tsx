import SupplierDocuments from "@/components/SupplierDocuments";
import type { loadSupplierDocuments } from "./data";

type Documents = Awaited<ReturnType<typeof loadSupplierDocuments>>;

// PLH-3l P2: extracted from /supplier/page.tsx Legal documents card.
export default function LegalDocsEditor({
  documents,
  blobConfigured,
}: {
  documents: Documents;
  blobConfigured: boolean;
}) {
  return (
    <div id="legal" className="card">
      <div className="card-head">
        <h2>Legal documents</h2>
      </div>
      <div className="card-body">
        <SupplierDocuments
          blobConfigured={blobConfigured}
          initialDocuments={documents.map((d) => ({
            id: d.id,
            kind: d.kind,
            filename: d.filename,
            url: d.url,
            status: d.status,
            reviewNote: d.reviewNote,
            uploadedAt: d.uploadedAt.toISOString(),
            reviewedAt: d.reviewedAt ? d.reviewedAt.toISOString() : null,
          }))}
        />
      </div>
    </div>
  );
}
