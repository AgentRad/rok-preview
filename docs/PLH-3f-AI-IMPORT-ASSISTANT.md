# PLH-3f — Conversational AI Catalog Import Assistant

Paste this into a fresh build chat AFTER PLH-3e ships and is verified.

```
# CONTEXT
You're working on PartsPort at C:\Users\radfe\rok-preview, branch
claude/industrial-marketplace-ROwAU. Read CLAUDE.md, HABITS.md,
docs/ORCHESTRATOR.md, docs/PLH-3f-AI-IMPORT-ASSISTANT.md.

This round builds a Workspace-style conversational AI catalog import
assistant. Conrad's framing: "Like how Google has the AI thing for
Excel / PowerPoint. Supplier pastes a sloppy sheet, talks to the AI
to clean it up, AI maps it to PartsPort schema, supplier reviews and
ships."

This was Phase I in the original CLAUDE.md build plan: "AI import
assistant: a guided, bounded assistant that helps a supplier map a
messy spreadsheet to the PartsPort product schema and resolve
ambiguities conversationally. Not an open-ended chatbot. Human review
and explicit approval before any data goes live."

# DELIVERABLE

A new flow at `/supplier/catalog-import` that:

1. Supplier pastes a CSV / TSV / Excel-clipboard text into a textarea
   OR uploads a .csv / .xlsx file (.xlsx parsed via SheetJS / a
   lightweight alternative; pick the smallest dependency)
2. Server inspects the parse, returns: detected delimiter, detected
   header row, column names as-found, sample rows, and a first-pass
   map of source column -> PartsPort schema field (manufacturer, sku,
   name, category, priceCents, stock, etaDays, weightLbs, lengthIn,
   widthIn, heightIn, freightClass, imageUrl)
3. Supplier sees the proposed mapping in a side-by-side preview
4. Supplier can chat with the AI: "Cat# is the SKU, ignore the totals
   row at the bottom, prices are in cents not dollars, treat any
   'B/O' value in the price column as quote-only"
5. AI rewrites the mapping rules and the preview updates
6. When supplier is happy, they click "Import all"; server runs the
   final batched transactional insert via the existing parse-and-
   import code path from PLH-2 Phase 4a

# BUILD PLAN

## Files to add

### `src/lib/import-mapping.ts`
The mapping primitive. Pure functions, no Prisma:
- `type ImportMapping = { srcColumn: string; dstField: PartsPortField | null; transform?: { kind: 'identity' | 'cents-to-dollars' | 'dollars-to-cents' | 'literal'; literal?: string } }[]`
- `inferMapping(rawHeaders: string[]): ImportMapping` — heuristic, no AI, picks the obvious matches by header name similarity
- `applyMapping(rows: Record<string, unknown>[], mapping: ImportMapping, filters: { skipRowIf?: 'totals' | 'empty' | { regex: string } }): Result<Row>` — returns the canonical PartsPort row shape per row
- `validateRow(row): { ok: boolean; errors: string[] }` — same checks as the existing POST /api/supplier/products (manufacturer must be claimed, price > 0, etc.)

### `src/lib/import-ai.ts`
Wraps Anthropic streaming for the conversational layer:
- `streamMappingHelp({ supplierContext, currentMapping, sampleRows, userMessage }): AsyncIterable<string>`
- Constant system prompt that explains the PartsPort schema and the JSON shape it must return at the end of every reply: `{ explanation: string, proposed_mapping: ImportMapping, proposed_filters: {...} }`
- The supplier's actual data (sample rows) goes in a user-turn block, NOT the system prompt, so the prompt cache hits on the system part
- 4000-char cap on userMessage, same rate-limit bucket as the existing `ai-assistant` (30/hr/supplier) but new bucket name `import-ai`

### `src/app/api/supplier/catalog-import/route.ts` (extend or rewrite the existing route)
Three actions multiplexed via a `body.action` field:
- `"parse"`: takes raw text or file blob, returns parsed headers + sample rows + inferred mapping. No DB writes.
- `"chat"`: takes `{ mapping, filters, sampleRows, userMessage }`, streams AI back with a new proposed mapping
- `"commit"`: takes `{ mapping, filters }` plus the same raw text/file ref, runs the existing PLH-2 Phase 4a transactional batched insert, returns the count of products created/updated and the row-by-row errors for failures
- All actions auth-gated to SUPPLIER role with canEditCatalog
- Rate limits: existing `catalog-import` bucket for parse/commit, new `import-ai` bucket for chat

### `src/app/supplier/catalog-import/page.tsx`
The UI. Three panels:
- Left: raw paste textarea OR file uploader, with a "Parse" button
- Center: the AI chat panel. Streams responses, user types follow-ups. Show the AI's current proposed mapping as a small JSON-like card the supplier can read.
- Right: live preview of the first 25 rows AFTER applying the current mapping + filters, with red highlights on rows that would fail validation
- Bottom: "Import all (N rows)" button, disabled until there are >0 valid rows

Match the existing supplier dashboard design language. No em dashes.
Editorial / industrial aesthetic per src/app/globals.css.

## Files to modify

### `src/app/supplier/page.tsx`
Add a tile linking to /supplier/catalog-import labeled "Import catalog
with AI." Same visual treatment as the existing CSV import tile (if
one exists; otherwise add it next to inventory management).

### `src/lib/csv.ts`
Probably no changes needed; reuse parseCsv. If parseCsv doesn't
return per-row metadata (line number, raw values), extend it to do so
for the preview UI.

### Schema
No schema changes. The existing Product model is what we're writing to.
The conversational state lives in client memory; no need to persist
the chat across sessions (the audit log captures the final commit).

# DATA FLOW

```
[Paste/Upload]
       |
       v
POST /api/supplier/catalog-import { action: "parse", raw, kind: "csv|xlsx" }
       |
       v
{ headers, sampleRows, inferredMapping, inferredFilters }
       |
       v
[Preview rendered]
       |
       v  (supplier types: "Cat# is SKU")
POST /api/supplier/catalog-import { action: "chat", mapping, filters, sampleRows, userMessage }
       |
       v  (streams response)
[Mapping JSON updated, preview re-renders]
       |
       v  (supplier clicks Import)
POST /api/supplier/catalog-import { action: "commit", mapping, filters, raw }
       |
       v
{ created: N, updated: M, errors: [...], auditLogId }
```

# AUDIT + SAFETY

- Every commit writes an AuditLog row `CATALOG_IMPORT_COMMITTED` with
  metadata { rowCount, mappingHash, filterHash, supplierId }
- AI assistant responses are also audited via the existing pattern from
  the supplier AI assistant: hash of question + token usage + timestamp
- The AI NEVER writes to the database. Only the supplier's explicit
  "Import all" click commits.
- Validation runs server-side at commit time regardless of what the
  AI claimed during chat (defense in depth — AI can't bless a row that
  fails validateRow)
- Manufacturer field still goes through isClaimedManufacturer per PLH-3c
  F1
- The PLH-2 Phase 4a hardening still applies: 2 MB body cap, BOM strip,
  csvSafeCell on any future export, transactional rollback on partial
  failure
- If supplier uploads XLSX: max file size 2 MB, parsed in-memory only
  (no disk persistence)

# VERIFY

- npx next build (must pass)
- Vitest: add a unit test for inferMapping (known input headers ->
  expected mapping), applyMapping (transforms applied correctly), and
  validateRow (rejects bad rows)
- Manual: log in as supplier@partsport.example, navigate to
  /supplier/catalog-import, paste a messy sample CSV like:
    "Item#,Description,Brand,Stock,Cost"
    "PT-123,Pad-mount transformer 500kVA,Siemens,4,3500"
    "PT-124,B/O Pad-mount 750kVA,Siemens,0,B/O"
    "TOTAL,,,4,3500"
  Confirm the preview shows two valid rows + one row flagged
  quote-only + one row flagged as a totals row to skip after the AI
  chat. Click Import. Confirm products created in the supplier
  catalog.

# COMMITS

Sequential commits:
1. PLH-3f S0: scaffolding — import-mapping.ts pure functions + tests
2. PLH-3f S1: extend /api/supplier/catalog-import with action multiplex
3. PLH-3f S2: import-ai.ts streaming wrapper + new rate-limit bucket
4. PLH-3f S3: /supplier/catalog-import page UI (three-panel layout)
5. PLH-3f S4: AuditLog + dashboard tile link

Push to origin claude/industrial-marketplace-ROwAU. Update CLAUDE.md
Status section + docs/ORCHESTRATOR.md per the standing rule.

# OUT OF SCOPE

- XLSX with multiple sheets (only Sheet1 supported for now)
- Image extraction from XLSX cells
- Custom server-side AI tools / function-calling beyond the JSON-shape
  return (we keep it simple: the AI returns a mapping, server
  validates)
- Bulk update of EXISTING products (this is import-only; product
  edits stay in the per-product PATCH route)
- Persisting chat history server-side
```
