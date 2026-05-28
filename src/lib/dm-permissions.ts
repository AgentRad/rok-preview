import "server-only";
import { prisma } from "./db";

/**
 * PLH-3q: who can DM whom.
 *
 * Rules:
 *   - BUYER       -> suppliers they have an active or historical Quote or
 *                    Order with; admin.
 *   - SUPPLIER    -> buyers from their own Quotes/Orders; OEMs whose
 *                    products they sell; admin; other supplier teammates.
 *                    Requires canSendMessages on at least one of their
 *                    SupplierMember rows (OWNER/ADMIN/SALES/FULFILLMENT).
 *   - MANUFACTURER (OEM) -> suppliers who carry their products
 *                    (Product.manufacturer matches their
 *                    manufacturerName); admin.
 *   - ADMIN       -> anyone.
 *
 * Returns false on unknown user, suspended supplier teammate, or
 * unpublished/unapproved OEM.
 */

type MiniUser = {
  id: string;
  role: string;
  manufacturerName: string | null;
};

async function loadUser(id: string): Promise<MiniUser | null> {
  const u = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, manufacturerName: true, deletedAt: true },
  });
  if (!u || u.deletedAt) return null;
  return { id: u.id, role: u.role, manufacturerName: u.manufacturerName };
}

async function activeSupplierIdsForUser(userId: string): Promise<string[]> {
  const ids = new Set<string>();
  const members = await prisma.supplierMember.findMany({
    where: { userId, supplier: { status: { not: "SUSPENDED" } } },
    select: { supplierId: true, role: true },
  });
  for (const m of members) {
    if (["OWNER", "ADMIN", "SALES", "FULFILLMENT"].includes(m.role)) {
      ids.add(m.supplierId);
    }
  }
  const legacy = await prisma.supplier.findMany({
    where: { userId, status: { not: "SUSPENDED" } },
    select: { id: true },
  });
  for (const s of legacy) ids.add(s.id);
  return Array.from(ids);
}

async function buyerHasRelationshipWithSupplier(
  buyerUserId: string,
  supplierId: string
): Promise<boolean> {
  const order = await prisma.order.findFirst({
    where: {
      buyerId: buyerUserId,
      items: { some: { product: { supplierId } } },
    },
    select: { id: true },
  });
  if (order) return true;
  const quote = await prisma.quoteRequest.findFirst({
    where: { buyerId: buyerUserId, product: { supplierId } },
    select: { id: true },
  });
  return !!quote;
}

async function supplierHasRelationshipWithBuyer(
  supplierIds: string[],
  buyerUserId: string
): Promise<boolean> {
  if (supplierIds.length === 0) return false;
  const order = await prisma.order.findFirst({
    where: {
      buyerId: buyerUserId,
      items: { some: { product: { supplierId: { in: supplierIds } } } },
    },
    select: { id: true },
  });
  if (order) return true;
  const quote = await prisma.quoteRequest.findFirst({
    where: {
      buyerId: buyerUserId,
      product: { supplierId: { in: supplierIds } },
    },
    select: { id: true },
  });
  return !!quote;
}

async function supplierCarriesOemProducts(
  supplierIds: string[],
  manufacturerName: string
): Promise<boolean> {
  if (supplierIds.length === 0 || !manufacturerName) return false;
  const p = await prisma.product.findFirst({
    where: { supplierId: { in: supplierIds }, manufacturer: manufacturerName },
    select: { id: true },
  });
  return !!p;
}

async function oemIsApproved(userId: string): Promise<boolean> {
  const app = await prisma.manufacturerApplication.findUnique({
    where: { userId },
    select: { status: true },
  });
  return app?.status === "APPROVED";
}

/**
 * PLH-3q P3: returns the email + userId of every current participant on a
 * DM thread except the excluded user (typically the just-posted sender).
 * Used by the inbound webhook and /api/messages POST to fan out a thread
 * message to every other participant.
 */
export async function resolveDirectMessageRecipients(
  threadId: string,
  excludeUserId: string
): Promise<{ email: string; userId: string }[]> {
  const parts = await prisma.directMessageParticipant.findMany({
    where: { threadId, userId: { not: excludeUserId } },
    select: {
      userId: true,
      user: { select: { email: true } },
    },
  });
  return parts
    .filter((p) => !!p.user.email)
    .map((p) => ({ email: p.user.email.toLowerCase(), userId: p.userId }));
}

export async function canStartDirectMessage(
  senderUserId: string,
  recipientUserId: string
): Promise<boolean> {
  if (!senderUserId || !recipientUserId) return false;
  if (senderUserId === recipientUserId) return false;
  const [sender, recipient] = await Promise.all([
    loadUser(senderUserId),
    loadUser(recipientUserId),
  ]);
  if (!sender || !recipient) return false;

  if (sender.role === "ADMIN" || recipient.role === "ADMIN") return true;

  if (sender.role === "BUYER") {
    if (recipient.role !== "SUPPLIER") return false;
    const supplierIds = await activeSupplierIdsForUser(recipient.id);
    if (supplierIds.length === 0) return false;
    for (const sid of supplierIds) {
      if (await buyerHasRelationshipWithSupplier(sender.id, sid)) return true;
    }
    return false;
  }

  if (sender.role === "SUPPLIER") {
    const senderSupplierIds = await activeSupplierIdsForUser(sender.id);
    if (senderSupplierIds.length === 0) return false;
    if (recipient.role === "SUPPLIER") {
      const recSupplierIds = await activeSupplierIdsForUser(recipient.id);
      return senderSupplierIds.some((id) => recSupplierIds.includes(id));
    }
    if (recipient.role === "BUYER") {
      return supplierHasRelationshipWithBuyer(senderSupplierIds, recipient.id);
    }
    if (recipient.role === "MANUFACTURER") {
      if (!recipient.manufacturerName) return false;
      if (!(await oemIsApproved(recipient.id))) return false;
      return supplierCarriesOemProducts(
        senderSupplierIds,
        recipient.manufacturerName
      );
    }
    return false;
  }

  if (sender.role === "MANUFACTURER") {
    if (!sender.manufacturerName) return false;
    if (!(await oemIsApproved(sender.id))) return false;
    if (recipient.role !== "SUPPLIER") return false;
    const recSupplierIds = await activeSupplierIdsForUser(recipient.id);
    return supplierCarriesOemProducts(recSupplierIds, sender.manufacturerName);
  }

  return false;
}

/**
 * Any participant on a DM thread with permission to message the new
 * person is allowed to add them. Delegates to canStartDirectMessage.
 */
export async function canAddParticipant(
  adderUserId: string,
  threadId: string,
  newParticipantUserId: string
): Promise<boolean> {
  const onThread = await prisma.directMessageParticipant.findUnique({
    where: { threadId_userId: { threadId, userId: adderUserId } },
    select: { id: true },
  });
  if (!onThread) return false;
  const already = await prisma.directMessageParticipant.findUnique({
    where: {
      threadId_userId: { threadId, userId: newParticipantUserId },
    },
    select: { id: true },
  });
  if (already) return false;
  return canStartDirectMessage(adderUserId, newParticipantUserId);
}
