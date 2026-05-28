import "server-only";
import { prisma } from "./db";
import { writeAuditLog } from "./audit";
import { captureError } from "./observability";

// ---------------------------------------------------------------------------
// PLH-3y-6: approval engine
//
// evaluateAndApplyApproval  -- called immediately after order creation.
//   Returns the final approvalStatus string so the caller can decide whether
//   to proceed to Stripe checkout (NONE / AUTO_APPROVED) or redirect to the
//   "pending approval" holding page (PENDING).
//
// advanceApproval           -- called when an approver (or admin bypass) acts.
//   Advances the chain, closes the order (APPROVED / REJECTED), and returns
//   the new approvalStatus.
//
// Design constraints (from the spec):
//   - Non-org buyers and org buyers with no matching rules are completely
//     unaffected. The NONE path is a fast no-op.
//   - ADMIN approval short-circuits the remaining chain immediately.
//   - OOO delegation is resolved at step-creation time so the concrete
//     approverMemberId is always set on the OrderApproval row.
// ---------------------------------------------------------------------------

export type ApprovalOutcome = "NONE" | "PENDING" | "AUTO_APPROVED" | "APPROVED" | "REJECTED" | "BYPASSED";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Walk the OOO delegation chain for a BuyerOrgMember, capped at 3 hops to
 * prevent cycles. Returns the final delegate's memberId (or the original
 * when no active delegation exists).
 */
async function resolveApproverMember(memberId: string): Promise<string> {
  let current = memberId;
  for (let hop = 0; hop < 3; hop++) {
    const member = await prisma.buyerOrgMember.findUnique({
      where: { id: current },
      select: { oooUntil: true, delegateToMemberId: true },
    });
    if (
      !member ||
      !member.delegateToMemberId ||
      !member.oooUntil ||
      member.oooUntil <= new Date()
    ) {
      break;
    }
    current = member.delegateToMemberId;
  }
  return current;
}

/**
 * Find the BuyerOrgMember id for a given userId within an org. Returns null
 * when the user is not a member (e.g. guest checkout with a buyerOrgId set
 * from a stale session -- shouldn't happen but belt).
 */
async function memberIdForUser(
  userId: string,
  buyerOrgId: string
): Promise<string | null> {
  const m = await prisma.buyerOrgMember.findUnique({
    where: { buyerOrgId_userId: { buyerOrgId, userId } },
    select: { id: true },
  });
  return m?.id ?? null;
}

/**
 * Check whether the buyer has a prior order from the same supplier with a
 * total within 25% of the current one, placed in the last 90 days by the
 * same BuyerOrgMember. Used by the autoApproveIfHistoricalMatch flag.
 */
async function hasHistoricalMatch(args: {
  supplierId: string | null;
  totalCents: number;
  placedByMemberId: string;
}): Promise<boolean> {
  if (!args.supplierId) return false;
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const lo = Math.floor(args.totalCents * 0.75);
  const hi = Math.ceil(args.totalCents * 1.25);
  // A "historical match" means there is a prior PAID order in the window from
  // the same member to the same supplier whose total is within 25%.
  const count = await prisma.order.count({
    where: {
      status: "PAID",
      createdAt: { gte: since },
      totalCents: { gte: lo, lte: hi },
      approvedByMemberId: args.placedByMemberId,
      supplierSlots: {
        some: { supplierId: args.supplierId },
      },
    },
  });
  return count > 0;
}

// ---------------------------------------------------------------------------
// evaluateAndApplyApproval
// ---------------------------------------------------------------------------

export async function evaluateAndApplyApproval(
  orderId: string
): Promise<ApprovalOutcome> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerOrgId: true,
        buyerId: true,
        totalCents: true,
        supplierSlots: { select: { supplierId: true } },
        items: { select: { productId: true } },
      },
    });
    if (!order || !order.buyerOrgId) {
      // No org context: NONE (completely unaffected).
      return "NONE";
    }

    // Load ALL enabled rules for this org.
    const rules = await prisma.approvalRule.findMany({
      where: { buyerOrgId: order.buyerOrgId, enabled: true },
      orderBy: { chainOrder: "asc" },
    });
    if (rules.length === 0) {
      // Org exists but has no rules configured: NONE.
      return "NONE";
    }

    // Find the buyer's org membership.
    const placedByMemberId = order.buyerId
      ? await memberIdForUser(order.buyerId, order.buyerOrgId)
      : null;

    // The primary supplierId for match purposes: take the first slot's
    // supplierId. Multi-supplier orders match any rule that covers any slot.
    const supplierIds = order.supplierSlots.map((s) => s.supplierId);
    const primarySupplierId = supplierIds[0] ?? null;

    // Filter rules that match the order.
    const matchedRules = rules.filter((r) => {
      // Amount range: both bounds are inclusive and optional.
      if (r.minTotalCents !== null && order.totalCents < r.minTotalCents) return false;
      if (r.maxTotalCents !== null && order.totalCents > r.maxTotalCents) return false;
      // Supplier scope: rule applies to a specific supplier only.
      if (r.supplierId && !supplierIds.includes(r.supplierId)) return false;
      // Placed-by scope: rule applies to a specific member only.
      if (r.placedByMemberId && r.placedByMemberId !== placedByMemberId) return false;
      return true;
    });

    if (matchedRules.length === 0) {
      // Rules exist for the org but none match this order: NONE.
      return "NONE";
    }

    // Historical auto-approve: if every matched rule with
    // autoApproveIfHistoricalMatch = true has a historical match, auto-approve.
    const autoMatchRules = matchedRules.filter((r) => r.autoApproveIfHistoricalMatch);
    if (autoMatchRules.length === matchedRules.length && autoMatchRules.length > 0 && placedByMemberId) {
      const allMatch = await Promise.all(
        supplierIds.map((sid) =>
          hasHistoricalMatch({
            supplierId: sid,
            totalCents: order.totalCents,
            placedByMemberId,
          })
        )
      );
      if (allMatch.every(Boolean)) {
        await prisma.$transaction([
          prisma.orderApproval.create({
            data: {
              orderId: order.id,
              ruleId: autoMatchRules[0].id,
              approverMemberId: placedByMemberId,
              outcome: "AUTO_APPROVED",
              reason: "Historical match auto-approval.",
            },
          }),
          prisma.order.update({
            where: { id: order.id },
            data: { approvalStatus: "AUTO_APPROVED" },
          }),
        ]);
        return "AUTO_APPROVED";
      }
    }

    // Standard path: create the first PENDING approval step.
    // Group rules by chainGroup (null = no group). Within a group rules are
    // chained (must all approve in order). Different groups are independent
    // (AND logic: all groups must approve for the order to be fully approved).
    // For the initial step we create one PENDING row per chain-group for the
    // first rule in each group.
    //
    // Simplified for C2: create one PENDING step from the first matched rule.
    // Multi-step chaining (advancing to the next rule in the chain) is handled
    // in advanceApproval when the first step resolves. The full chain is thus
    // materialized lazily so rule edits before later steps fire apply.
    const firstRule = matchedRules[0];

    // Resolve the concrete approver (member or role-based).
    let resolvedApproverMemberId: string | null = null;
    if (firstRule.approverMemberId) {
      resolvedApproverMemberId = await resolveApproverMember(firstRule.approverMemberId);
    } else if (firstRule.approverRole) {
      // Role-based: pick the first ADMIN or APPROVER in the org (oldest first
      // for stability). OOO-resolve the picked member.
      const m = await prisma.buyerOrgMember.findFirst({
        where: { buyerOrgId: order.buyerOrgId, role: firstRule.approverRole },
        orderBy: { joinedAt: "asc" },
        select: { id: true },
      });
      if (m) {
        resolvedApproverMemberId = await resolveApproverMember(m.id);
      }
    }

    await prisma.$transaction([
      prisma.orderApproval.create({
        data: {
          orderId: order.id,
          ruleId: firstRule.id,
          approverMemberId: resolvedApproverMemberId,
          outcome: "PENDING",
          chainOrder: firstRule.chainOrder,
        },
      }),
      prisma.order.update({
        where: { id: order.id },
        data: { approvalStatus: "PENDING" },
      }),
    ]);

    return "PENDING";
  } catch (err) {
    // Never let an approval evaluation failure block order creation.
    captureError(err, { subsystem: "approval", op: "evaluate", orderId });
    return "NONE";
  }
}

// ---------------------------------------------------------------------------
// advanceApproval
// ---------------------------------------------------------------------------

/**
 * Act on an open approval step: approve, reject, or bypass (admin only).
 *
 * - If the decider is an ADMIN of the org, the decision short-circuits the
 *   entire chain (approve closes immediately; reject closes immediately).
 * - On approve of a non-final chain step, the next matched rule's step is
 *   created PENDING.
 * - On approve of the final step, the order is APPROVED.
 * - On reject at any step, the order is REJECTED.
 *
 * Returns the new approvalStatus or null when the step was not found /
 * the caller is not authorized.
 */
export async function advanceApproval(args: {
  orderId: string;
  deciderMemberId: string;
  decision: "APPROVE" | "REJECT";
  reason?: string;
}): Promise<ApprovalOutcome | null> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: args.orderId },
      select: {
        id: true,
        buyerOrgId: true,
        buyerId: true,
        totalCents: true,
        approvalStatus: true,
        supplierSlots: { select: { supplierId: true } },
      },
    });
    if (!order || !order.buyerOrgId) return null;
    if (order.approvalStatus !== "PENDING") return null;

    // Verify the decider is a member of the org.
    const decider = await prisma.buyerOrgMember.findUnique({
      where: { id: args.deciderMemberId },
      select: { id: true, buyerOrgId: true, role: true },
    });
    if (!decider || decider.buyerOrgId !== order.buyerOrgId) return null;

    // Find the active PENDING step for this order.
    const pendingStep = await prisma.orderApproval.findFirst({
      where: { orderId: args.orderId, outcome: "PENDING" },
      orderBy: { chainOrder: "asc" },
    });
    if (!pendingStep) return null;

    // Authorization: must be the assigned approver OR an org ADMIN.
    const isAdmin = decider.role === "ADMIN";
    const isAssigned = pendingStep.approverMemberId === args.deciderMemberId;
    if (!isAdmin && !isAssigned) return null;

    const isReject = args.decision === "REJECT";
    const reason = args.reason?.trim().slice(0, 500) ?? "";

    if (isReject) {
      // Reject closes the whole chain immediately.
      await prisma.$transaction([
        prisma.orderApproval.update({
          where: { id: pendingStep.id },
          data: {
            outcome: "REJECTED",
            approverMemberId: args.deciderMemberId,
            reason,
            decidedAt: new Date(),
          },
        }),
        prisma.order.update({
          where: { id: args.orderId },
          data: { approvalStatus: "REJECTED" },
        }),
      ]);
      await writeAuditLog({
        actor: { id: decider.id, email: "" },
        action: "ORDER_REJECTED",
        targetType: "Order",
        targetId: args.orderId,
        summary: `Approval rejected${reason ? ": " + reason : ""}.`,
        metadata: { stepId: pendingStep.id, deciderMemberId: args.deciderMemberId },
      });
      return "REJECTED";
    }

    // Approve: ADMIN always short-circuits the chain.
    if (isAdmin) {
      await prisma.$transaction([
        prisma.orderApproval.update({
          where: { id: pendingStep.id },
          data: {
            outcome: "APPROVED",
            approverMemberId: args.deciderMemberId,
            reason: reason || "Admin approved.",
            decidedAt: new Date(),
          },
        }),
        prisma.order.update({
          where: { id: args.orderId },
          data: {
            approvalStatus: "APPROVED",
            approvedByMemberId: args.deciderMemberId,
          },
        }),
      ]);
      await writeAuditLog({
        actor: { id: decider.id, email: "" },
        action: "ORDER_APPROVED",
        targetType: "Order",
        targetId: args.orderId,
        summary: "Admin short-circuit approval.",
        metadata: { stepId: pendingStep.id, deciderMemberId: args.deciderMemberId },
      });
      return "APPROVED";
    }

    // Non-admin approve: check whether there is a next rule in the chain.
    // Load the rules that applied to this order again (same filter logic as
    // evaluate) and find the next one after this step's chainOrder.
    const currentRule = pendingStep.ruleId
      ? await prisma.approvalRule.findUnique({
          where: { id: pendingStep.ruleId },
          select: { chainGroup: true, chainOrder: true, buyerOrgId: true },
        })
      : null;

    let nextApproval: { ruleId: string; approverMemberId: string | null; chainOrder: number } | null = null;
    if (currentRule?.chainGroup) {
      // Find the next rule in the same chainGroup with a higher chainOrder.
      const supplierIds = order.supplierSlots.map((s) => s.supplierId);
      const nextRule = await prisma.approvalRule.findFirst({
        where: {
          buyerOrgId: order.buyerOrgId,
          enabled: true,
          chainGroup: currentRule.chainGroup,
          chainOrder: { gt: currentRule.chainOrder },
          // Apply the same amount filter.
          OR: [
            { minTotalCents: null },
            { minTotalCents: { lte: order.totalCents } },
          ],
        },
        orderBy: { chainOrder: "asc" },
      });
      if (nextRule) {
        let approverMemberId: string | null = null;
        if (nextRule.approverMemberId) {
          approverMemberId = await resolveApproverMember(nextRule.approverMemberId);
        } else if (nextRule.approverRole) {
          const m = await prisma.buyerOrgMember.findFirst({
            where: { buyerOrgId: order.buyerOrgId, role: nextRule.approverRole },
            orderBy: { joinedAt: "asc" },
            select: { id: true },
          });
          if (m) approverMemberId = await resolveApproverMember(m.id);
        }
        nextApproval = { ruleId: nextRule.id, approverMemberId, chainOrder: nextRule.chainOrder };
      }
    }

    if (nextApproval) {
      // Advance to the next step; keep order.approvalStatus = PENDING.
      await prisma.$transaction([
        prisma.orderApproval.update({
          where: { id: pendingStep.id },
          data: {
            outcome: "APPROVED",
            approverMemberId: args.deciderMemberId,
            reason: reason || "",
            decidedAt: new Date(),
          },
        }),
        prisma.orderApproval.create({
          data: {
            orderId: args.orderId,
            ruleId: nextApproval.ruleId,
            approverMemberId: nextApproval.approverMemberId,
            outcome: "PENDING",
            chainOrder: nextApproval.chainOrder,
          },
        }),
        // Keep approvalStatus PENDING for the next step.
        prisma.order.update({
          where: { id: args.orderId },
          data: { approvalStatus: "PENDING" },
        }),
      ]);
      await writeAuditLog({
        actor: { id: decider.id, email: "" },
        action: "ORDER_APPROVED",
        targetType: "Order",
        targetId: args.orderId,
        summary: "Step approved; awaiting next approver.",
        metadata: { stepId: pendingStep.id, nextRuleId: nextApproval.ruleId },
      });
      return "PENDING";
    }

    // Final step approved.
    await prisma.$transaction([
      prisma.orderApproval.update({
        where: { id: pendingStep.id },
        data: {
          outcome: "APPROVED",
          approverMemberId: args.deciderMemberId,
          reason: reason || "",
          decidedAt: new Date(),
        },
      }),
      prisma.order.update({
        where: { id: args.orderId },
        data: {
          approvalStatus: "APPROVED",
          approvedByMemberId: args.deciderMemberId,
        },
      }),
    ]);
    await writeAuditLog({
      actor: { id: decider.id, email: "" },
      action: "ORDER_APPROVED",
      targetType: "Order",
      targetId: args.orderId,
      summary: "All approval steps complete. Order approved.",
      metadata: { stepId: pendingStep.id, deciderMemberId: args.deciderMemberId },
    });
    return "APPROVED";
  } catch (err) {
    captureError(err, { subsystem: "approval", op: "advance", orderId: args.orderId });
    return null;
  }
}
