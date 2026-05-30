import "server-only";

/**
 * PLH-1 commit 3: magic-byte MIME sniffing. file.type is supplied by the
 * client and trivially forgeable; we re-derive the type from the actual
 * file bytes before persisting. Returns null when the file doesn't match
 * any allowed signature so the caller can reject.
 *
 * Detects PDF, JPEG, PNG, and WEBP (the only formats supplier docs and
 * logos accept post-PLH-1).
 */

const PDF_SIG = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const JPEG_SIG = [0xff, 0xd8, 0xff];
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF_SIG = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_SIG = [0x57, 0x45, 0x42, 0x50]; // "WEBP"

function startsWith(buf: Uint8Array, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (buf[offset + i] !== sig[i]) return false;
  }
  return true;
}

/**
 * Sanitize a user-supplied filename extension before it lands in a blob
 * key. Lowercases, strips non-alphanumerics, caps at 6 chars.
 */
export function safeExt(filename: string, fallback = "pdf"): string {
  const ext = filename.split(".").pop()?.toLowerCase() || fallback;
  return ext.replace(/[^a-z0-9]/g, "").slice(0, 6) || fallback;
}

export async function detectMagic(file: File): Promise<string | null> {
  const slice = file.slice(0, 16);
  const buf = new Uint8Array(await slice.arrayBuffer());
  if (startsWith(buf, PDF_SIG)) return "application/pdf";
  if (startsWith(buf, JPEG_SIG)) return "image/jpeg";
  if (startsWith(buf, PNG_SIG)) return "image/png";
  // WEBP: RIFF....WEBP, with the WEBP marker at byte 8.
  if (startsWith(buf, RIFF_SIG) && startsWith(buf, WEBP_SIG, 8)) {
    return "image/webp";
  }
  return null;
}
