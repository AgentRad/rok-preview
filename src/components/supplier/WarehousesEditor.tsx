import SupplierWarehouses from "@/components/SupplierWarehouses";
import type { loadSupplierWarehouses } from "./data";

type Warehouses = Awaited<ReturnType<typeof loadSupplierWarehouses>>;

// PLH-3l P2: extracted from /supplier/page.tsx Origin warehouses card.
export default function WarehousesEditor({
  warehouses,
}: {
  warehouses: Warehouses;
}) {
  return (
    <div id="warehouses" className="card">
      <div className="card-head">
        <h2>Origin warehouses</h2>
      </div>
      <div className="card-body">
        <SupplierWarehouses
          initial={warehouses.map((w) => ({
            id: w.id,
            label: w.label,
            zip: w.zip,
            city: w.city,
            state: w.state,
            isDefault: w.isDefault,
          }))}
        />
      </div>
    </div>
  );
}
