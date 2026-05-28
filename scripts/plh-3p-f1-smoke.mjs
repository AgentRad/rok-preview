// PLH-3p F1 smoke test: fan-out to supplier teammates on a real RFQ thread.
// Reads DATABASE_URL from process.env (load via `node --env-file`).
// Steps:
//   1. Find an open RFQ + its supplier.
//   2. Upsert User row for rad+supp2@agentgaming.gg (SUPPLIER role).
//   3. Upsert SupplierMember row (role MEMBER does not exist; using SALES
//      which satisfies canSendMessages and matches the spec intent).
//   4. Report the IDs so the next step (curl post) can target them.

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const TEAMMATE_EMAIL = "rad+supp2@agentgaming.gg";
const TEAMMATE_NAME = "Rad Supplier Teammate";

async function main() {
  const quote = await prisma.quoteRequest.findFirst({
    where: {
      status: { notIn: ["DECLINED", "ACCEPTED"] },
      OR: [
        { quoteExpiresAt: null },
        { quoteExpiresAt: { gt: new Date() } },
      ],
    },
    include: { product: { include: { supplier: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!quote) throw new Error("No open RFQ found in demo data.");
  const supplier = quote.product.supplier;
  console.log("RFQ:", quote.id, quote.reference, "supplier:", supplier.id, supplier.name, "contactEmail:", supplier.contactEmail);

  // bcrypt hash for "demo1234" (same as demo accounts). Computed offline; not
  // a secret — public on the demo guide.
  const PW_HASH = "$2b$10$VkOOJ.QtX5h/Cnvy4MhE/eNeAFI0SR.l5KhsKxz5MIeRRWBfn5cyG";

  const teammate = await prisma.user.upsert({
    where: { email: TEAMMATE_EMAIL },
    update: { role: "SUPPLIER" },
    create: {
      email: TEAMMATE_EMAIL,
      name: TEAMMATE_NAME,
      passwordHash: PW_HASH,
      role: "SUPPLIER",
      emailVerified: true,
    },
  });
  console.log("Teammate user:", teammate.id, teammate.email);

  // Spec said "role MEMBER"; the actual enum is SupplierMemberRole = OWNER,
  // ADMIN, SALES, FULFILLMENT, CATALOG, FINANCE, VIEWER. canSendMessages
  // accepts OWNER/ADMIN/SALES/FULFILLMENT. Using SALES so we exercise a
  // non-OWNER role on the fan-out path.
  const member = await prisma.supplierMember.upsert({
    where: { supplierId_userId: { supplierId: supplier.id, userId: teammate.id } },
    update: { role: "SALES" },
    create: { supplierId: supplier.id, userId: teammate.id, role: "SALES" },
  });
  console.log("SupplierMember:", member.id, "role:", member.role);

  // Print existing member list for visibility.
  const all = await prisma.supplierMember.findMany({
    where: { supplierId: supplier.id },
    include: { user: { select: { email: true } } },
  });
  console.log("All members on supplier:", all.map(m => ({ email: m.user.email, role: m.role })));

  // Find an admin to post the message via API as.
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  console.log("Admin to post as:", admin?.email);

  console.log(JSON.stringify({
    quoteId: quote.id,
    quoteRef: quote.reference,
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierContactEmail: supplier.contactEmail,
    teammateEmail: TEAMMATE_EMAIL,
    teammateUserId: teammate.id,
    adminEmail: admin?.email,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
