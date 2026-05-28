import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";
import {
  canSendMessages,
  userHasAccessToSupplier,
} from "@/lib/supplier-access";
import {
  visibilitiesVisibleTo,
  type ViewerRole,
} from "@/lib/message-visibility";
import { safeExt } from "@/lib/upload-validation";

export const runtime = "nodejs";

// PLH-3p F2: attachments per message.
//
// POST: upload one file per request body. Sender (or admin) only. Magic-byte
// MIME enforced. Cap 5 MB per file, 5 attachments per message total.
// GET:  list attachments for the message. Same access check as the thread,
// honors F3 visibility (don't leak attachments on a hidden message).

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PER_MESSAGE = 5;

type AttachmentMime =
  | "image/png"
  | "image/jpeg"
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const EXT_BY_MIME: Record<AttachmentMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};

async function detectAttachmentMime(
  file: File
): Promise<AttachmentMime | null> {
  const buf = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46
  ) {
    return "application/pdf";
  }
  // DOCX is a zip (PK\x03\x04) with a specific [Content_Types].xml entry.
  // Full detection requires unzipping; we accept the zip signature when
  // the filename ends with .docx as a best-effort check.
  if (
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    buf[2] === 0x03 &&
    buf[3] === 0x04 &&
    file.name.toLowerCase().endsWith(".docx")
  ) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return null;
}

type AuthOk = {
  ok: true;
  message: NonNullable<Awaited<ReturnType<typeof loadMessage>>>;
  viewerRole: ViewerRole;
  isAdmin: boolean;
  isSender: boolean;
  userId: string;
  userEmail: string;
};
type AuthErr = { ok: false; status: number; error: string };

async function loadMessage(messageId: string) {
  return prisma.message.findUnique({
    where: { id: messageId },
    include: {
      order: {
        include: {
          items: { include: { product: { select: { supplierId: true } } } },
        },
      },
      quote: { include: { product: { select: { supplierId: true } } } },
    },
  });
}

async function authorize(
  messageId: string
): Promise<AuthOk | AuthErr> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401, error: "Please sign in." };
  const message = await loadMessage(messageId);
  if (!message) return { ok: false, status: 404, error: "Message not found." };

  const isAdmin = user.role === "ADMIN";
  let viewerRole: ViewerRole = "none";

  if (message.orderId && message.order) {
    const order = message.order;
    const isBuyer = !!order.buyerId && order.buyerId === user.id;
    let isOrderSupplier = false;
    if (user.role === "SUPPLIER") {
      const supplierIds = Array.from(
        new Set(order.items.map((it) => it.product.supplierId))
      );
      const checks = await Promise.all(
        supplierIds.map((id) => userHasAccessToSupplier(user.id, id))
      );
      isOrderSupplier = checks.some((c) => c.ok && canSendMessages(c.role));
    }
    if (!isBuyer && !isAdmin && !isOrderSupplier) {
      return { ok: false, status: 403, error: "Not authorized." };
    }
    viewerRole = isAdmin ? "admin" : isOrderSupplier ? "supplier" : "buyer";
  } else if (message.quoteId && message.quote) {
    const quote = message.quote;
    const isBuyer = !!quote.buyerId && quote.buyerId === user.id;
    let isQuoteSupplier = false;
    if (user.role === "SUPPLIER") {
      const access = await userHasAccessToSupplier(
        user.id,
        quote.product.supplierId
      );
      isQuoteSupplier = access.ok && canSendMessages(access.role);
    }
    if (!isBuyer && !isAdmin && !isQuoteSupplier) {
      return { ok: false, status: 403, error: "Not authorized." };
    }
    viewerRole = isAdmin ? "admin" : isQuoteSupplier ? "supplier" : "buyer";
  } else {
    return { ok: false, status: 404, error: "Message thread not found." };
  }

  const allowed = visibilitiesVisibleTo(viewerRole);
  if (!allowed.includes(message.visibility)) {
    return { ok: false, status: 403, error: "Not authorized." };
  }

  const isSender = !!message.senderId && message.senderId === user.id;
  return {
    ok: true,
    message,
    viewerRole,
    isAdmin,
    isSender,
    userId: user.id,
    userEmail: user.email,
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authorize(id);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const attachments = await prisma.messageAttachment.findMany({
    where: { messageId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fileName: true,
      fileSize: true,
      mimeType: true,
      blobUrl: true,
    },
  });
  return NextResponse.json({ attachments });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "File uploads are not configured on this deployment." },
      { status: 503 }
    );
  }
  const { id } = await params;
  const auth = await authorize(id);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.isSender && !auth.isAdmin) {
    return NextResponse.json(
      { error: "Only the message sender can attach files." },
      { status: 403 }
    );
  }
  const limit = await rateLimit("messages", `user:${auth.userId}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Slow down a moment, then try again." },
      { status: 429 }
    );
  }

  const existing = await prisma.messageAttachment.count({
    where: { messageId: id },
  });
  if (existing >= MAX_PER_MESSAGE) {
    return NextResponse.json(
      { error: `Max ${MAX_PER_MESSAGE} attachments per message.` },
      { status: 400 }
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json(
      { error: "Invalid upload payload." },
      { status: 400 }
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file attached." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `${file.name}: too large (${(file.size / 1024 / 1024).toFixed(
          1
        )} MB). Max 5 MB.`,
      },
      { status: 400 }
    );
  }
  const mime = await detectAttachmentMime(file);
  if (!mime) {
    return NextResponse.json(
      { error: `${file.name}: unsupported type. Use PNG, JPEG, PDF, or DOCX.` },
      { status: 400 }
    );
  }

  const ext = EXT_BY_MIME[mime] || safeExt(file.name, "bin");
  const suffix = crypto.randomBytes(8).toString("hex");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) ||
    `file.${ext}`;
  const blobPath = `messages/${id}/${suffix}-${safeName}`;

  let blobUrl: string;
  try {
    const blob = await put(blobPath, file, {
      access: "public",
      contentType: mime,
    });
    blobUrl = blob.url;
  } catch (err) {
    captureError(err, { subsystem: "messages", op: "attachment-upload", messageId: id });
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }

  const attachment = await prisma.messageAttachment.create({
    data: {
      messageId: id,
      fileName: file.name.slice(0, 200) || safeName,
      fileSize: file.size,
      mimeType: mime,
      blobUrl,
    },
    select: {
      id: true,
      fileName: true,
      fileSize: true,
      mimeType: true,
      blobUrl: true,
    },
  });

  await writeAuditLog({
    actor: { id: auth.userId, email: auth.userEmail },
    action: "MESSAGE_ATTACHMENT_UPLOADED",
    targetType: "Message",
    targetId: id,
    summary: `Attached ${attachment.fileName} (${attachment.fileSize} bytes) to message`,
    metadata: {
      messageId: id,
      mime,
      bytes: file.size,
      source: "ui",
    },
  });

  return NextResponse.json(attachment);
}
