import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { disconnectCredential } from "@/lib/qbo-auth";
import { siteUrl } from "@/lib/site-url";
import { writeAuditLog } from "@/lib/audit";

/**
 * PLH-3i P1: admin-only QuickBooks disconnect. Deletes any
 * IntegrationCredential rows for provider=quickbooks_online, audit-logs
 * the action, and redirects back to the connect page.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const removed = await disconnectCredential();

  await writeAuditLog({
    actor: { id: user.id, email: user.email },
    action: "QBO_DISCONNECTED",
    targetType: "IntegrationCredential",
    targetId: "quickbooks_online",
    summary: `Disconnected QuickBooks Online (${removed} credential row(s) removed).`,
    metadata: { removed },
  });

  return NextResponse.redirect(siteUrl("/admin/integrations/quickbooks"), {
    status: 303,
  });
}
