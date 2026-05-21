import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const companyName = String(b.companyName || "").trim();
  const contactName = String(b.contactName || "").trim();
  const email = String(b.email || "").toLowerCase().trim();
  if (!companyName || !contactName || !email) {
    return NextResponse.json(
      { error: "Company, contact name and email are required." },
      { status: 400 }
    );
  }
  await prisma.supplierApplication.create({
    data: {
      companyName,
      contactName,
      email,
      website: String(b.website || "").trim(),
      category: String(b.category || "Other / multiple"),
      yearsTrading: String(b.yearsTrading || "Not specified"),
      certs: String(b.certs || "").trim(),
      message: String(b.message || "").trim(),
      status: "PENDING",
    },
  });
  return NextResponse.json({ ok: true });
}
