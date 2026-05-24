/**
 * Minimal RFC-4180-style CSV parser. Handles quoted fields, embedded commas,
 * embedded quotes (escaped as "") and CRLF/LF line endings. Does not stream.
 * Sufficient for supplier bulk uploads in the hundreds-of-rows range.
 */
export function parseCsv(text: string): string[][] {
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
