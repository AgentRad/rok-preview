import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : null;
  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  const manufacturerName =
    typeof body.manufacturerName === "string"
      ? body.manufacturerName.trim() || null
      : undefined;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      name,
      ...(user.role === "MANUFACTURER" && manufacturerName !== undefined
        ? { manufacturerName }
        : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
