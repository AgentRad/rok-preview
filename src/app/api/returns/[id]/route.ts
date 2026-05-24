import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

const ACTIONS = ["approve", "reject", "resolve"] as const;
type Action = (typeof ACTIONS)[number];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body.action as Action | undefined;
  if (!action || !ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  const note = String(body.note || "").trim().slice(0, 4000);

  const r = await prisma.returnRequest.findUnique({ where: { id } });
  if (!r) {
    return NextResponse.json({ error: "Return not found." }, { status: 404 });
  }

  const statusMap: Record<Action, "APPROVED" | "REJECTED" | "RESOLVED"> = {
    approve: "APPROVED",
    reject: "REJECTED",
    resolve: "RESOLVED",
  };

  await prisma.returnRequest.update({
    where: { id },
    data: {
      status: statusMap[action],
      adminNote: note || r.adminNote,
      resolvedAt: action === "resolve" ? new Date() : r.resolvedAt,
    },
  });

  return NextResponse.json({ ok: true });
}
