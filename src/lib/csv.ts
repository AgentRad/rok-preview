/**
 * Minimal RFC-4180-style CSV parser. Handles quoted fields, embedded commas,
 * embedded quotes (escaped as "") and CRLF/LF line endings. Does not stream.
 * Sufficient for supplier bulk uploads in the hundreds-of-rows range.
 */
export function parseCsv(text: string): string[][] {
  // PLH-2 Phase 4a (A5): strip leading UTF-8 BOM. Excel and many other
  // tools prepend U+FEFF to CSV exports; without this, the first header
  // cell is silently "﻿sku" instead of "sku" and every column
  // lookup against that header fails.
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      // skip; \n handles the row terminator
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // last field / row if no trailing newline
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Reads a CSV with the first row as the header. Returns rows as keyed objects.
 * Unknown headers are kept, missing headers become empty strings.
 */
export function parseCsvWithHeader(text: string): Record<string, string>[] {
  const rows = parseCsv(text).filter(
    (r) => !(r.length === 1 && r[0].trim() === "")
  );
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = (cells[i] ?? "").trim();
    }
    return obj;
  });
}

/**
 * PLH-2 Phase 4a (A6): defuse CSV formula injection. Cells beginning with
 * `=`, `+`, `-`, `@`, TAB, or CR are interpreted as a formula by Excel,
 * LibreOffice, Google Sheets, and Numbers. A malicious supplier name like
 * `=HYPERLINK("http://evil","Click")` becomes a live link when an admin
 * opens the export. Prefixing such cells with a single quote stops the
 * spreadsheet from evaluating them. The quote is invisible in the cell.
 * Wrap this output the same way other escaping wraps it (quotes, commas,
 * newlines): the caller still has to do the CSV-quote step.
 */
export function csvSafeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.length === 0) return s;
  const c = s.charCodeAt(0);
  // = + - @ TAB(0x09) CR(0x0d)
  if (c === 0x3d || c === 0x2b || c === 0x2d || c === 0x40 || c === 0x09 || c === 0x0d) {
    return "'" + s;
  }
  return s;
}
