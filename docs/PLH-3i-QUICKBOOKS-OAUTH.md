# PLH-3i — QuickBooks Online OAuth full sync

Paste this into a fresh build chat. This is the deferred Phase K from
the original CLAUDE.md build plan. Today PartsPort only has a CSV
export at `/api/admin/invoices-quickbooks.csv`. This round adds the
real Intuit OAuth flow + automatic sync.

```
# CONTEXT
You're working on PartsPort at C:\Users\radfe\rok-preview, branch
claude/industrial-marketplace-ROwAU. Read CLAUDE.md, HABITS.md,
docs/ORCHESTRATOR.md.

The QuickBooks Online CSV export ships today (P12 Commit 5). It works
but requires the admin to manually download + import via the QBO
"Import Customers and Invoices" flow. Real OAuth sync is the Phase K
endgame: PartsPort holds a long-lived QBO refresh token, automatically
creates Customer + Invoice records in QBO when an order is paid,
optionally syncs payment status back via webhooks.

# DELIVERABLE

1. Admin OAuth connect flow: /admin/integrations/quickbooks
   page with "Connect QuickBooks" button -> Intuit OAuth consent
   -> callback stores refresh token in a new IntegrationCredential
   table
2. Sync on order paid: when markOrderPaid() fires, queue a
   background job that creates QBO Customer (if not already linked)
   and QBO Invoice via Intuit API
3. Sync on order refunded: post a refund receipt or credit memo to
   the existing QBO invoice
4. Daily sync reconciliation cron: walks orders paid in the last
   30 days, flags any that don't have a synced QBO invoice id, retries
5. Admin dashboard widget: connection status, last sync time, count
   of synced invoices, errors in last 24h with a "view" link

# BUILD PLAN

## Phase 1: Intuit OAuth + IntegrationCredential model

Add a new Prisma model:

```
model IntegrationCredential {
  id              String   @id @default(cuid())
  provider        String   // "quickbooks_online"
  realmId         String   // Intuit's company id, unique per QBO
                           // company
  accessToken     String   // encrypted at rest (use existing
                           // ENCRYPTION_KEY pattern if it exists,
                           // else store raw with @db.Text and note
                           // it as a known gap)
  refreshToken    String
  expiresAt       DateTime
  connectedByUserId String
  connectedAt     DateTime @default(now())
  lastUsedAt      DateTime?

  @@unique([provider, realmId])
}
```

Migration: add the table, no backfill needed.

Add /api/admin/integrations/quickbooks/start GET: builds the Intuit
OAuth URL with state=signed-csrf-token, scope=com.intuit.quickbooks.accounting,
and redirect_uri=siteUrl("/api/admin/integrations/quickbooks/callback").
Generate state via crypto.randomBytes signed by SESSION_SECRET so the
callback can verify.

Add /api/admin/integrations/quickbooks/callback GET: validates state,
exchanges code for access+refresh token via Intuit, stores in
IntegrationCredential, redirects to /admin/integrations/quickbooks.

Admin page: shows "not connected" or "connected to <company name>"
with a Disconnect button.

Env vars (owner sets in Vercel before this works):
- INTUIT_CLIENT_ID
- INTUIT_CLIENT_SECRET
- INTUIT_ENVIRONMENT = "sandbox" or "production"

Without these env vars, the page renders "QuickBooks integration is
not configured" and the route returns 503 (mirroring the AI
assistant pattern).

Commit: "PLH-3i P1: Intuit OAuth connect flow + IntegrationCredential"

## Phase 2: QBO sync on order paid

src/lib/qbo-sync.ts (new): wraps the Intuit API for the operations
PartsPort needs:
- ensureCustomer(buyer): finds-or-creates a QBO Customer with the
  buyer's email + name. Caches the QBO customer id on a new
  `User.qboCustomerId` field (migration).
- createInvoice(order, customerId): creates a QBO Invoice with line
  items, freight, fee (as separate items), tax (let QBO compute or
  pass through), references PartsPort order ref in DocNumber.
- refreshAccessToken(): standard refresh-token flow when access
  token expires (1 hour TTL).

In src/lib/order-utils.ts markOrderPaid: after the PartsPort Invoice
row is created, fire-and-await via `after()`:
- if IntegrationCredential exists for quickbooks_online
- call ensureCustomer + createInvoice
- store QBO invoice id on the PartsPort Invoice row (new field
  `qboInvoiceId String?`)
- audit log QBO_INVOICE_SYNCED with metadata { orderId, qboInvoiceId,
  realmId }

On failure: write QBO_SYNC_FAILED audit row with error string, but
do NOT block the response. Buyer's checkout still succeeds.

Commit: "PLH-3i P2: QBO sync on markOrderPaid via after()"

## Phase 3: QBO sync on refund

When refundOrder runs and the order has a qboInvoiceId, post a
QBO refund receipt or credit memo against that invoice id for the
refund amount. Audit log QBO_REFUND_SYNCED.

Commit: "PLH-3i P3: QBO refund sync on refundOrder"

## Phase 4: Reconciliation cron

/api/cron/qbo-reconcile (new): daily, walks PartsPort Invoices paid
in the last 30 days where qboInvoiceId is null AND
IntegrationCredential exists. Retries the createInvoice call. Caps
at MAX_PER_RUN=200 with ASC ordering + hasMore (PLH-2 4e pattern).

Add to vercel.json crons.

Commit: "PLH-3i P4: qbo-reconcile daily cron"

## Phase 5: Admin dashboard widget

/admin/integrations/quickbooks page extended:
- Connection status (connected, last refresh, company name from QBO)
- Stat tiles: synced invoices total, synced last 30d, sync errors
  last 24h with metadata
- "View errors" link to /admin/audit filtered to QBO_SYNC_FAILED
- "Disconnect" button (deletes IntegrationCredential row + writes
  audit)

Commit: "PLH-3i P5: admin QBO dashboard widget"

# CROSS-CUTTING REQUIREMENTS

- ALL Intuit API calls wrap-and-rethrow with captureError so Sentry
  picks them up when wired
- Token refresh handled in one helper so all callers don't have to
  worry about expiry
- Rate limit Intuit API calls (Intuit's published limit is 500
  requests per minute per realm; PartsPort won't hit this at launch
  but the helper should add a simple in-memory throttle)
- All sync operations write AuditLog
- $transaction wrap on the IntegrationCredential write + token
  refresh write
- Encrypt access/refresh tokens at rest if there's an ENCRYPTION_KEY
  env pattern in place; otherwise document as a known gap and store
  raw in @db.Text

# REPORTING

After each phase: HEAD hash, files changed. After all phases:
update CLAUDE.md Status + docs/ORCHESTRATOR.md per standing rule.
Mark Phase K as DONE in the original build plan, replacing the
"CSV substitute shipped" note.

# OWNER TASKS BEFORE THIS WORKS IN PROD

Conrad sets these in Vercel:
- INTUIT_CLIENT_ID (from a new Intuit developer app)
- INTUIT_CLIENT_SECRET
- INTUIT_ENVIRONMENT=sandbox (or production for live)

Then he hits /admin/integrations/quickbooks, clicks Connect, walks
through Intuit's OAuth consent screen, lands back on PartsPort with
connection live.
```
