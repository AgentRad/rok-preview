# PLH-3j — Deferred polish batch

Paste this into a fresh build chat. This rolls up the MEDIUM/LOW
items that were explicitly skipped during PLH-2 + PLH-3 audits and
queued in docs/ORCHESTRATOR.md as backlog. None ship-block launch
individually, but together they close most of the post-launch debt.

```
# CONTEXT
You're working on PartsPort at C:\Users\radfe\rok-preview, branch
claude/industrial-marketplace-ROwAU. Read CLAUDE.md, HABITS.md,
docs/ORCHESTRATOR.md.

This is a deferred-polish batch. Each item is small. Ship sequentially,
one commit per item. If anything is harder than expected, drop with
a one-line note in the final report and move on.

# FIXES (one commit each, in this order)

## P1 — Address book hard cap (25 per buyer)
Surface: src/app/api/addresses/route.ts POST.
Add a precheck: count(Address where userId=user.id), reject 400 if
>= 25 with "Address book is full. Delete an unused address first."

## P2 — Soft-delete addresses referenced by historical orders
Surface: src/app/api/addresses/[id]/route.ts DELETE.
Today DELETE removes the row. If any Order references this Address
relation, the order loses its ship-to. Mirror the Supplier
soft-delete pattern: add `Address.deletedAt DateTime?` + filter
deletedAt=null on read paths. DELETE flips deletedAt instead of
actually deleting. Migration: add the column + index.

## P3 — Phone format validation
Surface: src/lib/addresses.ts validateAddress.
Today phone is capped but not format-checked. Use libphonenumber-js
(npm i, ~50KB, tree-shakable) to parse E.164. Reject obviously
broken numbers with structured 400 { field: "phone", error: ... }.

## P4 — Tax-exempt cert expiry + reminder cron
Schema: add `taxExemptExpiresAt DateTime?` to Address (or wherever
the tax-exempt cert lives today).
UI: tax-exempt upload form prompts for expiry date.
New cron /api/cron/tax-exempt-expiry (daily): finds certs expiring
in the next 30 days, emails the buyer to refresh, audit-logs
TAX_EXEMPT_EXPIRY_NOTICE. Re-prompts on the order detail page if
expired and they're about to checkout.

## P5 — Unsubscribe response renders re-subscribe affordance
Surface: src/app/api/email/unsubscribe (the public route from
PLH-2 4d) response HTML.
Today: confirms unsubscribe in plain text. Add a single button
"Re-subscribe" that posts to /api/email/resubscribe (new endpoint
behind the same signed token) and flips notifyMarketingEmails back
on. Saves the buyer from finding /settings on their own.

## P6 — Apply MAX_PER_RUN to remaining crons
Surface: src/app/api/cron/anonymize-deleted-accounts,
src/app/api/cron/cleanup-unverified-accounts,
src/app/api/cron/payout-retry, src/app/api/cron/health-check.
PLH-2 4e capped auto-deliver + reserve-release. PLH-3e B9 capped
connect-sync. These four still iterate unbounded. Add MAX_PER_RUN=200,
ASC ordering, hasMore in the response (same pattern as the others).

## P7 — Reconcile mismatch AuditLog dedupe
Surface: src/lib/reconcile.ts (or wherever the reconcile cron
writes mismatch audit rows).
Today: capped runs replay the same window and write the same
mismatch audit row multiple times. Add a unique index on
(action, targetId, metadata->>'kind', metadata->>'windowStart')
in a Prisma migration, then change the write to upsert with
ignoreDuplicates pattern.

## P8 — Refund amount visible on buyer's order page
Surface: src/app/orders/[id]/page.tsx.
Today: Order.refundedCents exists but is never rendered. When
> 0, render a "Refunded: $X.XX on <date>" line in the totals
breakdown. Pull the refund date from the latest Refund row for
this order.

## P9 — Cancel idempotency 409
Surface: src/app/api/orders/[id]/cancel/route.ts.
POST on an already-CANCELLED order today returns 200 ok-true,
which makes the client think it succeeded twice. Return 409 with
{ error: "Order is already cancelled." } when status is already
CANCELLED.

## P10 — /account order history pagination
Surface: src/app/account/page.tsx.
Today: loads all orders + items unbounded. Add take:25 + a "Load
more" button that fetches the next page via a paginated API route.
Server route: /api/account/orders GET with ?page=N param.

## P11 — Pagination on /admin/audit
Surface: src/app/admin/audit/page.tsx.
Same pattern as P10. Audit log grows fast; admin will need to
paginate within months of launch.

## P12 — Supplier-health alert thresholds configurable
Surface: src/app/admin/supplier-health/page.tsx +
src/lib/supplier-health.ts (if exists, otherwise inline).
Today: alert thresholds (refund > 5%, days-to-ship > 7, owed > 0,
inactive > 30d) are hardcoded. Move to env vars with sensible
defaults, OR to a new SystemSetting table that the admin can edit
via a small /admin/settings page.

Pick the simpler path. Env vars is fine if Conrad doesn't want to
build a settings UI.

## P13 — `manufacturer` editable on supplier Product PATCH (with
soft-brand check)
Surface: src/app/api/supplier/products/[id]/route.ts PATCH.
Today: the PATCH doesn't expose `manufacturer` at all, so legacy
products with unclaimed manufacturers are stuck. Add it back to
the data object BUT validate via isClaimedManufacturer (PLH-3c F1
pattern). If unclaimed: reject 400. If claimed: allow update.

## P14 — Product ownership belt-and-suspenders
Surface: src/app/api/supplier/products/[id]/route.ts GET + PATCH.
Today the route does findUnique({ where: { id } }) then checks
ownership via effectiveAccessToSupplier. Change to findFirst
({ where: { id, supplierId: { in: ownedSupplierIds } } }) so the
DB constraint enforces ownership without relying on app-layer
checks. The existing access check stays for the role split.

## P15 — Cancel order sends cancellation email
Surface: src/app/api/orders/[id]/cancel/route.ts.
PLH-3c F7 already shipped sendOrderCancelled. Verify it's wired up
correctly post-PLH-3e and doesn't leak past the notifyOrderEmails
gate from PLH-3b F1. If sendOrderCancelled is missing the
recipientUserId arg, add it.

## P16 — OEM logo blob path hash uniqueness
Surface: src/app/api/oem/profile/logo/route.ts.
PLH-3c F8 added randomBytes(8) suffix. Verify the path is
deterministic enough that an OEM uploading a NEW logo doesn't
collide with the old one's path. If today's code keeps both blobs
forever on disk, add a cleanup of the old blob when a new logo is
uploaded.

## P17 — Documentation: scripts/ directory README
Add a short README.md inside scripts/ documenting the smoke test
scripts pattern (now removed but might be recreated) so a future
session doesn't accidentally hardcode secrets into a script and
push them.

# CROSS-CUTTING REQUIREMENTS

- One commit per fix, sequential
- npx next build per commit
- Audit log on every state mutation
- $transaction wrap on any read-then-write
- No em dashes
- After each commit, push to origin

# REPORTING

After all 17 ship, update CLAUDE.md Status + docs/ORCHESTRATOR.md.
Move the corresponding entries from the "Post-launch backlog" lists
in ORCHESTRATOR.md to a "shipped" section. Drop any item from this
batch with a one-line note if it turned out to be harder than
expected, and queue as its own future round.
```
