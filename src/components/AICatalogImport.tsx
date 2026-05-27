"use client";

import { useMemo, useRef, useState } from "react";

type ImportMappingEntry = {
  srcColumn: string;
  dstField: string | null;
  transform?: { kind: string; literal?: string };
};
type ImportFilters = {
  skipRowIf?: "totals" | "empty" | { regex: string };
  quoteOnlyIfPriceMatches?: string;
};
type ChatMessage = { id: string; role: "user" | "assistant"; text: string };
type ParseResult = {
  delimiter: string;
  headers: string[];
  totalRows: number;
  sampleRows: Record<string, string>[];
  inferredMapping: ImportMappingEntry[];
  inferredFilters: ImportFilters;
};

const DST_FIELDS = [
  "",
  "sku",
  "name",
  "category",
  "manufacturer",
  "priceCents",
  "stock",
  "etaDays",
  "weightLbs",
  "lengthIn",
  "widthIn",
  "heightIn",
  "freightClass",
  "imageUrl",
  "description",
  "unit",
  "quoteOnly",
  "icon",
];

function extractMappingProposal(text: string): {
  mapping: ImportMappingEntry[];
  filters: ImportFilters;
} | null {
  const re = /```json\s*([\s\S]*?)```/gi;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) last = m[1];
  if (!last) return null;
  try {
    const parsed = JSON.parse(last.trim());
    if (!Array.isArray(parsed.proposed_mapping)) return null;
    return {
      mapping: parsed.proposed_mapping,
      filters: parsed.proposed_filters || {},
    };
  } catch {
    return null;
  }
}

function applyMappingClient(
  rows: Record<string, string>[],
  mapping: ImportMappingEntry[],
  filters: ImportFilters
): { canonical: Record<string, unknown>; rowNumber: number; src: Record<string, string> }[] {
  const out: {
    canonical: Record<string, unknown>;
    rowNumber: number;
    src: Record<string, string>;
  }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cells = Object.values(row).map((v) => String(v ?? "").trim());
    let skip = false;
    if (filters.skipRowIf === "empty" && cells.every((c) => !c)) skip = true;
    else if (filters.skipRowIf === "totals") {
      const joined = cells.join(" ").toLowerCase();
      if (/\b(total|subtotal|grand total|sum)\b/.test(joined)) skip = true;
    } else if (
      typeof filters.skipRowIf === "object" &&
      filters.skipRowIf.regex
    ) {
      try {
        const re = new RegExp(filters.skipRowIf.regex, "i");
        if (cells.some((c) => re.test(c))) skip = true;
      } catch {
        /* ignore */
      }
    }
    if (skip) continue;
    const canonical: Record<string, unknown> = {};
    let priceSrc = "";
    for (const m of mapping) {
      if (!m.dstField) continue;
      const raw = row[m.srcColumn] ?? "";
      if (m.dstField === "priceCents") priceSrc = String(raw);
      let v: unknown = raw;
      if (m.transform?.kind === "literal") v = m.transform.literal;
      else if (
        m.dstField === "priceCents" ||
        m.dstField === "stock" ||
        m.dstField === "etaDays" ||
        m.dstField === "weightLbs" ||
        m.dstField === "lengthIn" ||
        m.dstField === "widthIn" ||
        m.dstField === "heightIn"
      ) {
        const cleaned = String(raw).replace(/[$,\s]/g, "");
        const n = Number(cleaned);
        if (Number.isFinite(n)) {
          if (m.dstField === "priceCents") {
            if (m.transform?.kind === "cents-to-dollars") v = Math.round(n);
            else v = Math.round(n * 100);
          } else v = n;
        } else v = null;
      } else if (m.dstField === "quoteOnly") {
        const t = String(raw).trim().toLowerCase();
        v = ["true", "1", "yes", "y", "quote", "bo", "b/o"].includes(t);
      }
      canonical[m.dstField] = v;
    }
    if (
      !canonical.quoteOnly &&
      filters.quoteOnlyIfPriceMatches &&
      priceSrc
    ) {
      try {
        if (new RegExp(filters.quoteOnlyIfPriceMatches, "i").test(priceSrc)) {
          canonical.quoteOnly = true;
        }
      } catch {
        /* ignore */
      }
    }
    out.push({ canonical, rowNumber: i + 2, src: row });
  }
  return out;
}

function validateCanonical(c: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!c.sku) errors.push("Missing SKU");
  if (!c.name) errors.push("Missing name");
  if (!c.category) errors.push("Missing category");
  if (!c.manufacturer) errors.push("Missing manufacturer");
  const price =
    typeof c.priceCents === "number" ? c.priceCents : Number(c.priceCents) || 0;
  if (!c.quoteOnly && !(price > 0)) errors.push("Price must be > 0");
  return errors;
}

export default function AICatalogImport({
  aiEnabled,
  supplierName,
}: {
  aiEnabled: boolean;
  supplierName: string;
}) {
  void supplierName;
  const [raw, setRaw] = useState("");
  const [xlsxBase64, setXlsxBase64] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);

  const [mapping, setMapping] = useState<ImportMappingEntry[]>([]);
  const [filters, setFilters] = useState<ImportFilters>({});

  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);

  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{
    ok: boolean;
    counts?: { created: number; updated: number; invalid: number; total: number };
    rowErrors?: { rowNumber: number; error: string }[];
    partialResults?: { rowNumber: number; error: string }[];
    batchError?: string | null;
  } | null>(null);
  const [commitErr, setCommitErr] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    if (f.size > 2 * 1024 * 1024) {
      setParseErr("File too large. Maximum 2 MB.");
      return;
    }
    if (f.name.toLowerCase().endsWith(".xlsx")) {
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      setXlsxBase64(btoa(bin));
      setRaw("");
    } else {
      const text = await f.text();
      setRaw(text);
      setXlsxBase64(null);
    }
    setParsed(null);
    setMapping([]);
    setFilters({});
    setChat([]);
    setParseErr(null);
  }

  async function doParse() {
    setParsing(true);
    setParseErr(null);
    setCommitResult(null);
    try {
      const body: Record<string, unknown> = { action: "parse" };
      if (xlsxBase64) {
        body.fileBase64 = xlsxBase64;
        body.kind = "xlsx";
      } else {
        body.raw = raw;
        body.kind = "csv";
      }
      const res = await fetch("/api/supplier/catalog-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setParseErr(j.error || "Parse failed.");
        return;
      }
      setParsed(j);
      setMapping(j.inferredMapping || []);
      setFilters(j.inferredFilters || {});
    } finally {
      setParsing(false);
    }
  }

  async function sendChat() {
    const msg = chatInput.trim();
    if (!msg || chatBusy || !parsed) return;
    if (msg.length > 4000) {
      setChatErr("Message is too long, keep it under 4000 characters.");
      return;
    }
    setChatErr(null);
    setChatInput("");
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text: msg,
    };
    const aiId = `a-${Date.now()}`;
    setChat((c) => [...c, userMsg, { id: aiId, role: "assistant", text: "" }]);
    setChatBusy(true);
    try {
      const res = await fetch("/api/supplier/catalog-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat",
          mapping,
          filters,
          headers: parsed.headers,
          sampleRows: parsed.sampleRows,
          userMessage: msg,
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setChatErr(j.error || "The assistant could not respond.");
        setChat((c) => c.filter((x) => x.id !== aiId));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        full += chunk;
        setChat((c) =>
          c.map((x) => (x.id === aiId ? { ...x, text: x.text + chunk } : x))
        );
      }
      const proposal = extractMappingProposal(full);
      if (proposal) {
        setMapping(proposal.mapping);
        setFilters(proposal.filters);
      }
    } catch {
      setChatErr("Network error. Try again.");
      setChat((c) => c.filter((x) => x.id !== aiId));
    } finally {
      setChatBusy(false);
    }
  }

  const previewRows = useMemo(() => {
    if (!parsed) return [];
    return applyMappingClient(parsed.sampleRows, mapping, filters);
  }, [parsed, mapping, filters]);

  const previewValid = useMemo(() => {
    return previewRows.filter((r) => validateCanonical(r.canonical).length === 0)
      .length;
  }, [previewRows]);

  async function commit() {
    if (!parsed) return;
    setCommitting(true);
    setCommitErr(null);
    setCommitResult(null);
    try {
      const body: Record<string, unknown> = {
        action: "commit",
        mapping,
        filters,
      };
      if (xlsxBase64) {
        body.fileBase64 = xlsxBase64;
        body.kind = "xlsx";
      } else {
        body.raw = raw;
        body.kind = "csv";
      }
      const res = await fetch("/api/supplier/catalog-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCommitErr(j.error || "Import failed.");
        return;
      }
      setCommitResult(j);
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(280px, 1fr) minmax(320px, 1.2fr) minmax(380px, 1.4fr)",
        gap: 16,
        marginTop: 20,
        alignItems: "start",
      }}
    >
      {/* LEFT: paste / upload */}
      <div className="card">
        <div className="card-head">
          <h2>Source</h2>
        </div>
        <div className="card-body">
          <p className="muted-text" style={{ fontSize: 13, marginTop: 0 }}>
            Paste CSV or TSV, or upload .csv or .xlsx. First row should be
            column names.
          </p>
          <textarea
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setXlsxBase64(null);
              setFileName(null);
              if (fileRef.current) fileRef.current.value = "";
              setParsed(null);
            }}
            placeholder="Paste here..."
            spellCheck={false}
            style={{
              width: "100%",
              minHeight: 220,
              fontFamily: "var(--mono)",
              fontSize: 12.5,
              padding: 10,
              border: "1px solid var(--line-strong)",
              borderRadius: "var(--radius-sm)",
              background: "var(--surface)",
            }}
          />
          <div className="row-gap" style={{ marginTop: 10, alignItems: "center" }}>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.xlsx"
              onChange={onFile}
              style={{ fontSize: 12 }}
            />
            {fileName && (
              <span className="muted-text" style={{ fontSize: 12 }}>
                {fileName}
              </span>
            )}
          </div>
          <div className="row-gap" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={doParse}
              disabled={parsing || (!raw.trim() && !xlsxBase64)}
            >
              {parsing ? "Parsing..." : "Parse"}
            </button>
          </div>
          {parseErr && (
            <div className="alert alert-error" style={{ marginTop: 10 }}>
              {parseErr}
            </div>
          )}
          {parsed && (
            <div className="muted-text" style={{ fontSize: 12, marginTop: 10 }}>
              Delimiter: {parsed.delimiter === "\t" ? "tab" : parsed.delimiter}.{" "}
              {parsed.totalRows} rows, {parsed.headers.length} columns.
            </div>
          )}

          {parsed && mapping.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="invoice-meta-label" style={{ marginBottom: 6 }}>
                Mapping
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 6,
                  fontSize: 12.5,
                }}
              >
                {mapping.map((m, idx) => (
                  <div
                    key={`${m.srcColumn}-${idx}`}
                    style={{ display: "contents" }}
                  >
                    <code
                      style={{
                        fontFamily: "var(--mono)",
                        padding: "4px 6px",
                        background: "var(--bg-soft, #fafaf7)",
                        border: "1px solid var(--line)",
                        borderRadius: 4,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.srcColumn}
                    </code>
                    <select
                      value={m.dstField || ""}
                      onChange={(e) => {
                        const v = e.target.value || null;
                        setMapping((arr) =>
                          arr.map((x, i) =>
                            i === idx ? { ...x, dstField: v } : x
                          )
                        );
                      }}
                      style={{ fontSize: 12.5, padding: "3px 6px" }}
                    >
                      {DST_FIELDS.map((f) => (
                        <option key={f} value={f}>
                          {f || "(ignore)"}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 12 }} className="muted-text">
                Filters:{" "}
                <code style={{ fontFamily: "var(--mono)" }}>
                  {JSON.stringify(filters)}
                </code>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CENTER: chat */}
      <div className="card">
        <div className="card-head">
          <h2>AI assistant</h2>
          {!aiEnabled && (
            <span className="muted-text" style={{ fontSize: 12 }}>
              Unavailable
            </span>
          )}
        </div>
        <div className="card-body">
          {!aiEnabled ? (
            <p className="muted-text" style={{ fontSize: 13, marginTop: 0 }}>
              The AI assistant is not configured. Set ANTHROPIC_API_KEY to turn
              it on. You can still hand-map columns on the left.
            </p>
          ) : (
            <p className="muted-text" style={{ fontSize: 13, marginTop: 0 }}>
              Tell the assistant about quirks in your sheet. Examples: &quot;Cat#
              is the SKU&quot;, &quot;prices are in cents, not dollars&quot;,
              &quot;ignore the totals row at the bottom&quot;, &quot;treat B/O
              in the price column as quote-only&quot;.
            </p>
          )}
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: 6,
              padding: 12,
              minHeight: 220,
              maxHeight: 420,
              overflowY: "auto",
              background: "var(--bg-soft, #fafaf7)",
              marginBottom: 10,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {chat.length === 0 ? (
              <p className="muted-text" style={{ fontSize: 12.5, margin: 0 }}>
                Parse a file on the left, then chat here to refine the mapping.
              </p>
            ) : (
              chat.map((m) => (
                <div key={m.id} style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                      color: "var(--muted)",
                      marginBottom: 3,
                    }}
                  >
                    {m.role === "user" ? "You" : "Assistant"}
                  </div>
                  <div style={{ whiteSpace: "pre-wrap" }}>
                    {m.text || (
                      <span className="muted-text">Thinking...</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          {chatErr && (
            <div className="alert alert-error" style={{ marginBottom: 10 }}>
              {chatErr}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <textarea
              className="input"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void sendChat();
                }
              }}
              placeholder="Describe a quirk or rule..."
              rows={3}
              maxLength={4000}
              disabled={chatBusy || !aiEnabled || !parsed}
              style={{ flex: 1, resize: "vertical", fontSize: 13 }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void sendChat()}
              disabled={
                chatBusy || !aiEnabled || !parsed || chatInput.trim().length === 0
              }
              style={{ alignSelf: "flex-end" }}
            >
              {chatBusy ? "..." : "Send"}
            </button>
          </div>
          <div
            className="muted-text"
            style={{ fontSize: 11, marginTop: 6, textAlign: "right" }}
          >
            {chatInput.length} / 4000
          </div>
        </div>
      </div>

      {/* RIGHT: preview */}
      <div className="card">
        <div className="card-head">
          <h2>Preview</h2>
          {parsed && (
            <span className="muted-text" style={{ fontSize: 12 }}>
              {previewValid} / {previewRows.length} ready
            </span>
          )}
        </div>
        <div className="card-body">
          {!parsed ? (
            <p className="muted-text" style={{ fontSize: 13, marginTop: 0 }}>
              Parse a file to see the first 25 rows mapped to PartsPort format.
            </p>
          ) : previewRows.length === 0 ? (
            <p className="muted-text" style={{ fontSize: 13, marginTop: 0 }}>
              No rows survived the current filters.
            </p>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 420, overflow: "auto" }}>
              <table className="table" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>SKU</th>
                    <th>Name</th>
                    <th>Brand</th>
                    <th className="num">Price</th>
                    <th className="num">Stock</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r) => {
                    const errs = validateCanonical(r.canonical);
                    const c = r.canonical;
                    return (
                      <tr
                        key={r.rowNumber}
                        style={
                          errs.length > 0
                            ? { background: "rgba(176, 74, 44, 0.06)" }
                            : undefined
                        }
                      >
                        <td>{r.rowNumber}</td>
                        <td style={{ fontWeight: 700 }}>
                          {String(c.sku || "-")}
                        </td>
                        <td>{String(c.name || "-")}</td>
                        <td>{String(c.manufacturer || "-")}</td>
                        <td className="num">
                          {typeof c.priceCents === "number"
                            ? `$${(c.priceCents / 100).toFixed(2)}`
                            : "-"}
                        </td>
                        <td className="num">
                          {typeof c.stock === "number" ? c.stock : "-"}
                        </td>
                        <td style={{ fontSize: 11.5 }}>
                          {errs.length > 0 ? (
                            <span style={{ color: "var(--red)" }}>
                              {errs.join("; ")}
                            </span>
                          ) : c.quoteOnly ? (
                            <span className="badge badge-pending">
                              quote-only
                            </span>
                          ) : (
                            <span className="badge badge-approved">ok</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Bottom: commit bar */}
      <div style={{ gridColumn: "1 / -1" }}>
        <div
          className="card"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: 14,
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <div className="muted-text" style={{ fontSize: 13 }}>
            {parsed
              ? `Source has ${parsed.totalRows} rows. Preview shows the first 25. Server validates every row at commit time. Brand must match a claimed manufacturer.`
              : "Parse a file first."}
          </div>
          <button
            type="button"
            className="btn btn-dark"
            onClick={commit}
            disabled={committing || !parsed || previewValid === 0}
          >
            {committing
              ? "Importing..."
              : parsed
                ? `Import all (${parsed.totalRows} rows)`
                : "Import all"}
          </button>
        </div>
        {commitErr && (
          <div className="alert alert-error" style={{ marginTop: 10 }}>
            {commitErr}
          </div>
        )}
        {commitResult && (
          <div
            className={
              "alert " + (commitResult.ok ? "alert-ok" : "alert-error")
            }
            style={{ marginTop: 10 }}
          >
            {commitResult.ok ? (
              <>
                Imported {commitResult.counts?.created || 0} new and{" "}
                {commitResult.counts?.updated || 0} updated.
                {commitResult.counts?.invalid
                  ? ` ${commitResult.counts.invalid} rows had errors.`
                  : ""}
              </>
            ) : (
              <>
                Partial import. {commitResult.batchError || "See errors below."}
              </>
            )}
            {commitResult.rowErrors && commitResult.rowErrors.length > 0 && (
              <ul style={{ margin: "8px 0 0 18px", fontSize: 13 }}>
                {commitResult.rowErrors.slice(0, 12).map((e, i) => (
                  <li key={`${e.rowNumber}-${i}`}>
                    Row {e.rowNumber}: {e.error}
                  </li>
                ))}
                {commitResult.rowErrors.length > 12 && (
                  <li>...and {commitResult.rowErrors.length - 12} more</li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
