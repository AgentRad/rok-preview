import { getCurrentUser } from "@/lib/auth";
import HeaderNav from "./HeaderNav";

export default async function SiteHeader() {
  const user = await getCurrentUser();
  return (
    <>
      <div className="topbar">
        <div className="wrap">
          <span>
            Free buyer accounts · Vetted suppliers only · Delivery handled end to end
          </span>
          <span className="muted">
            Are you a supplier? <a href="/suppliers">Apply to sell →</a>
          </span>
        </div>
      </div>
      <HeaderNav
        user={user ? { name: user.name, role: user.role } : null}
      />
    </>
  );
}
