import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const certificateUrl = body.certificateUrl ? String(body.certificateUrl).trim() : "";

  if (!certificateUrl) {
    return NextResponse.json(
      { error: "Certificate URL is required." },
      { status: 400 }
    );
  }

  // Verify the address belongs to the user
  const address = await prisma.address.findUnique({
    where: { id },
  });

  if (!address || address.userId !== user.id) {
    return NextResponse.json(
      { error: "Address not found." },
      { status: 404 }
    );
  }

  // Update the address with the certificate
  const updated = await prisma.address.update({
    where: { id },
    data: {
      taxExemptCertificateUrl: certificateUrl,
      taxExemptStatus: "PENDING",
    },
  });

  return NextResponse.json({ ok: true, address: updated });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  const { id } = await params;

  // Verify the address belongs to the user
  const address = await prisma.address.findUnique({
    where: { id },
  });

  if (!address || address.userId !== user.id) {
    return NextResponse.json(
      { error: "Address not found." },
      { status: 404 }
    );
  }

  // Clear the certificate
  const updated = await prisma.address.update({
    where: { id },
    data: {
      taxExemptCertificateUrl: null,
      taxExemptStatus: "PENDING",
    },
  });

  return NextResponse.json({ ok: true, address: updated });
}
