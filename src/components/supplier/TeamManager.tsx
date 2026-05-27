import SupplierTeam from "@/components/SupplierTeam";

// PLH-3l P2: extracted from /supplier/page.tsx Team card.
export default function TeamManager() {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Team</h2>
      </div>
      <div className="card-body">
        <SupplierTeam />
      </div>
    </div>
  );
}
