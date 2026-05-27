# Orchestrator Brief

Read this if you're picking up as the orchestrator chat for PartsPort. Your job is coordination, not coding.

## Role

You sit between Rad, the build chat, and the test chats. You do not write production code. You do not run the testing team yourself. You triage, plan, and write prompts for the other chats to execute.

The build chat is deep in the codebase and ships fixes. The test chats are short-lived, walk the site as five user types, and report findings. You read what they produce, decide what matters, and write the next prompt.

## Inputs you handle

**Test chat reports.** Findings from a Polish round. Look for: critical functional fails, regressions in adjacent flows, soft bugs hiding inside passes (a fix shipped but with edge cases the spec missed). Group by severity, point at file paths, suggest concrete fixes.

**Build chat reports.** "Polish N done, here's what shipped." Read it. Verify the claim makes sense — did they say "fixed X" but the commit doesn't touch the right file? Did they ship the fix but miss a related bug that obviously rides with it? Catch incomplete claims before they reach the test chat.

**Rad's questions.** When he asks for strategy, give it. When he asks for code, redirect him to the build chat. When he reports a bug from his own browsing, treat it like a test chat finding — add it to the next punch list.

## Outputs you produce

**Punch lists for the build chat.** Numbered, severity-grouped, top-to-bottom ordered. Each item has: what broke, where (file:line), why (root cause if known), what the fix should do. End with "Ship in order, push, tell me when done."

**Verify prompts for fresh test chats.** Tailored to what was actually shipped, not what was promised. Include:
- "Read HABITS.md and docs/TEAM_TESTING.md" as the first line
- Specific items to verify with concrete acceptance criteria
- Reminder to run the full 5-POV surface matrix end-to-end
- Reminder to test idempotency, tail side effects, floors, silent-success patterns
- Output format: confirmed fixes / still broken / new issues / regressions

**Status checks for Rad.** When he asks "are we wasting time?", give him the trend. Count findings per round. Show severity declining. Honest about whether the platform is launch-ready or not.

## Triage rules

When the test chat reports N findings, rank them:

1. **Critical** — flow can't complete (buyer can't buy, supplier can't ship, admin can't approve). Always batch-1.
2. **High** — flow degraded (silent data corruption, missing notifications, auth gap on a sub-route, broken result counts). Always batch-2.
3. **Medium** — polish that affects UX but doesn't block a flow.
4. **Low** — cosmetic, copy, accessibility refinements.

If something has unclear severity, default it to High. The build chat can downgrade if they disagree.

A "soft bug" hidden inside a passing fix counts as High. Don't let it ride just because the parent fix passed.

## When to skip me and go direct

Rad can paste verify prompts straight to a fresh test chat WITHOUT going through me when:
- The build chat shipped something tiny (one-line fix, one config change) and the verify is obvious
- He's running a sanity check on his own, not a full round

Otherwise: build chat done → Rad pastes to me → I review → I write the verify prompt → Rad pastes to test chat. Skipping me means burning test cycles on incomplete builds.

## Signs you should hand off to a new orchestrator chat

- You're slower than you were three rounds ago
- You contradict yourself between messages in the same conversation
- You forget which round you're on
- You get a fact wrong about what's shipped (e.g. claim a feature is done that isn't)
- Rad asks the same question twice and you give different answers

When that happens, tell Rad. He opens a new chat, points it at the three docs (HABITS.md, docs/TEAM_TESTING.md, docs/ORCHESTRATOR.md) plus the latest punch list, and you're replaced. No work lost.

## Stop criteria for the build / test loop

The loop ends when a test chat reports:
- Zero critical findings
- Zero high findings
- Only medium / low items remain
- All 5 POVs walk every flow end-to-end without breaking

At that point, the platform is launch-ready. Ship it. Remaining polish items go into a post-launch backlog.

Don't keep running rounds for diminishing returns. Three rounds in a row finding only cosmetic items = the loop is done.

## The communication graph

```
        Rad (human)
       /    |    \
      /     |     \
     /      |      \
   You    Build   Test
 (this) (codebase) (5-POV)
     \   /
      \ /
       X  ← findings flow back through here
```

Rad is the message bus. He pastes between chats. Don't pretend you can talk to the build chat directly — you can't.

## Autonomous mode

The repo also has a self-running version of this loop at `.github/workflows/autonomous-loop.yml` driven by `scripts/auto/master-prompt.md`. It runs the test + triage + fix cycle as one Claude Code subprocess on Sonnet 4.6, billed to Rad's Anthropic account. Setup instructions are in `scripts/auto/README.md`.

When autonomous mode is enabled, the chat-based loop and the autonomous loop **should not both run on the same branch at the same time** — they'll step on each other's commits. Either Rad drives it manually (chats) or the workflow drives it (autonomous), not both. Pick one mode per session.

If the autonomous loop hits stop criteria, it posts a PR comment saying so and exits. At that point, Rad can ship.

If the autonomous loop crashes or gets stuck, Rad can resume the chat-based loop seamlessly — the docs in the repo brief any chat instantly.

## Pre-launch hardening (P12 + PLH-1 + PLH-2): DONE

**P12 (2026-05-26).** RFQ accept auth, real freight/tax via checkout
bridge, refund clawback ordering money-leak fix, quote expiry + idempotent
quote-to-order create, return refund routing, supplier reserve CHECK
constraints, quote lifecycle audit, supplier balance card, QuickBooks CSV
export, supplier-health dashboard. Migration:
`prisma/migrations/20260601120000_p12_quote_expiry_and_constraints`.

**PLH-1 (2026-05-26).** Pre-launch hardening audit, 5 commits, closed all
remaining CRITICAL plus relevant HIGH bugs across three surfaces:
1. **Auth / Account.** Server-side session invalidation via
   sessionsValidFrom + svf JWT claim. Password floor 8 cap 128.
   SESSION_SECRET refuses < 32 chars in production. Email verify token
   hashed at rest. Enumeration suppression on register + login. Register
   no longer auto-signs-in. Session-fixation interstitial on GET
   state-mutators. Account delete blocked on open orders. Anonymize and
   unverified-cleanup crons. Rate limits across all auth mutators.
2. **Supplier Onboarding.** Approval flow no longer mints "demo1234"
   temp passwords (reset-token email via forgot-password path). Server
   side go-live gate that re-runs the 10-item readiness check on
   publicVisible flip. SupplierDocument blobs private with audited
   download routes. Magic-byte MIME detection on document + logo
   uploads. URL-paste branch removed. Suspended suppliers blocked from
   orders and quotes. SVG removed from logo allow-list. Application
   rate-limit + soft idempotency. Bank-info PATCH writes a diff audit
   row + admin attention card. New connect-sync daily cron auto-flips
   publicVisible false when Stripe Connect payouts go from enabled to
   disabled.
3. **Multi-Supplier Orders.** Single-supplier cart constraint at launch
   (see Launch-time constraints in CLAUDE.md). charge.refunded webhook
   now runs the per-supplier clawback via the shared
   applySupplierClawback primitive, so out-of-band Stripe-dashboard
   refunds move reserveBalanceCents and owedToPlatformCents the same
   way admin-initiated refunds do.

Migrations:
- `prisma/migrations/20260602000000_plh1_session_security`
- `prisma/migrations/20260602010000_plh1_commit2_anonymized_at`

**PLH-2 (2026-05-26).** Final pre-launch round. Two new features plus a
five-area audit, all CRITICAL + HIGH closed:
1. **Phase 1: inbound email threading.** `/api/email/inbound` handles
   resend / postmark / sendgrid payloads with per-thread Reply-To
   addresses signed via HMAC-SHA256 (`src/lib/inbound-email.ts`). Constant
   time signature compare, sender matched to a known user, thread
   membership re-verified, quoted history stripped, body capped, fan-out
   via Next.js `after()`. Fail-closed 404 when `INBOUND_EMAIL_PROVIDER`
   unset.
2. **Phase 2: supplier AI assistant.** `/api/supplier/ai-assistant` streams
   Claude Sonnet 4.6 grounded in the supplier's own 30-day data window.
   Auth via active supplier context, rate-limited 30/hour/supplier,
   question capped 2000 chars, system prompt cache-controlled, question
   hash + token usage audit-logged. 503 when `ANTHROPIC_API_KEY` unset.
3. **Phase 4 audit** (5 sequential commits):
   - 4a CSV import: transactional batches, compound SKU ownership where,
     BOM strip, `csvSafeCell` across all 5 CSV export routes, 2 MB cap,
     rate limit.
   - 4b AI search: query cap, IP rate-limit on the catalog RSC, in-memory
     LRU cache, catalog cap at 500 rows.
   - 4c OEM storefront: `detectMagic` + `safeExt`, SVG dropped, rate
     limits, URL validation.
   - 4d addresses + notification prefs: per-user notification flags +
     `shouldSendToUser` + List-Unsubscribe + public unsubscribe route,
     rate limits + length caps + ISO country + postal regex, tax-exempt
     blob private with audited download.
   - 4e crons: `isAuthorizedCronRequest` on auto-deliver, no-swallow
     email failures, reserve-release 3-stage with PENDING/COMPLETED/FAILED
     status, `MAX_PER_RUN=200`, reconcile cursor + 7-day windows.

Migrations:
- `prisma/migrations/20260603000000_plh2_phase4d_notif_prefs`
- `prisma/migrations/20260604000000_plh2_phase4e_cron_audit`

All five PLH-2 audit areas (catalog CSV import, AI search, OEM
storefront, address book + notification preferences, daily crons) are
DONE. Auth flows + RFQ + returns + multi-supplier + refund clawback all
hardened across P12 + PLH-1 + PLH-2.

## Post-PLH-2 audit rounds (PLH-3a / 3b / 3c): DONE

Three additional audit rounds after PLH-2 closed, driven by an
orchestrator chat spawning Explore agents against surfaces that had not
been hit at PLH depth (admin daily-use, messaging + inbound email,
buyer post-purchase, OEM dashboard).

**PLH-3a (2026-05-26).** Admin supplier-health dashboard, 2 commits
(`bc2fe8f`, `d867786`). `Order.shippedAt` column + idempotent stamp
inside the shared `markOrderShipped()` helper + supplier-health page
now uses real `shippedAt - paidAt` (the prior `createdAt - paidAt`
math had the sign inverted, clamped every value to 0, and made the
"avg days-to-ship > 7" alert unfireable). Plus an `orderItem.findMany
where order.createdAt >= YTD_START` filter to stop the unbounded
load. Migration `20260605000000_add_order_shipped_at` includes a
`paidAt + 1 day` backfill estimate.

**PLH-3b (2026-05-26).** Messaging + inbound email threading
hardening. 8 commits (`d75d460` through `6402ff0`), 6 HIGH + 1
MEDIUM. F0 removed a duplicate `remotion/` folder accidentally landed
inside rok-preview. F1 wired PLH-2 4d's `notifyOrderEmails` opt-out
into `sendThreadMessage`. F2 added inbound dedup via
`Message.inboundFingerprint` unique index. F3 rejects replies to
terminal-status threads (REFUNDED/CANCELLED orders;
DECLINED/ACCEPTED/EXPIRED-via-quoteExpiresAt quotes). F4 audits + Sentry
on inbound fan-out failures (mirrors PLH-2 4e E2). F5 makes
`verifyAuth` fail closed in production when `INBOUND_WEBHOOK_SECRET`
is unset. F6 bumped HMAC signature from 64 to 128 bits. F7
rate-limited POST `/api/messages` at 20/min/user. Migration
`20260606000000_add_message_inbound_fingerprint`.

**PLH-3c (2026-05-26).** Buyer post-purchase flow + OEM dashboard. 9
commits (`423cada` through `2d78bd5`), 1 CRITICAL + 5 HIGH + 3 MEDIUM
+ 1 LOW. F0 closed a CRITICAL: `/orders/[id]` page computed viewer
auth values but never enforced them, so anyone with an order ID could
read PII. Added the four-way `isBuyer || isAdmin || isOrderSupplier
|| isGuestViaToken` gate plus `orderViewUrl()` signed-token helper in
all outbound order emails. F1 introduced the soft brand model:
`Product.manufacturer` must match a claimed OEM brand
(`src/lib/manufacturers.ts`). F2 added a partial unique index on
`User.manufacturerName WHERE role='MANUFACTURER'`. F3 added the OEM
approval gate via `ManufacturerApplication` with admin queue at
`/admin/manufacturer-applications` and auto-approve backfill for
existing OEMs. F4 added the same `?t=` signed-token URL pattern to
the guest invoice page. F5 added a 30-day post-delivery return window
with `Order.deliveredAt` stamped at three Delivered transition sites.
F6 swapped `slice.then.trim` to `trim.then.slice` on tagline/bio. F7
added `sendOrderCancelled`. F8 randomised the OEM logo blob path.
Migrations: `20260607000000_unique_oem_manufacturer_name`,
`20260607010000_add_manufacturer_application`,
`20260607020000_add_order_delivered_at`.

**PLH-3d (2026-05-26).** Svix signature verification for Resend
inbound webhooks. 1 commit (`7c5ec7f`). `verifyAuth(req, provider,
rawBody)` now dispatches on provider. Postmark and SendGrid paths
unchanged. Resend path implements Svix v1: reads `svix-id`,
`svix-timestamp`, `svix-signature` headers, rejects on > 5 min
timestamp drift, strips the `whsec_` prefix and base64-decodes
`INBOUND_WEBHOOK_SECRET` into HMAC key bytes, computes
`HMAC-SHA256(key, ${id}.${ts}.${rawBody})` in base64, and
timing-safe-compares against each `v1,<sig>` entry in the header.
`handleInbound` captures `req.text()` exactly once before verify and
parse (Svix needs the unparsed bytes). Parsing moved into
`parseBodyFromRaw(rawBody, provider, req)`. Resend reader also
handles the `{ type, data: { ... } }` envelope shape. PLH-3b F5
fail-closed rule preserved. No new migration; no existing inbound
vitest file to extend.

**PLH-3e (2026-05-26).** Targeted hardening, 8 commits. Section A
shipped 3 verified fixes; Section B evaluated 10 claims, shipped 5,
dropped 5.
- F1 (CRITICAL): `/api/checkout-from-quote/[id]` 410 on expired
  quote (closes the gap where an ACCEPTED-then-expired quote could
  still convert to a PENDING Order at the locked price).
- F2 (HIGH): same route enforces `user.emailVerified` (admins exempt).
- F3 (HIGH): admin application approve wrapped in `$transaction`
  with re-check on PENDING inside the tx; 409 on concurrent second
  POST. All writes route through `tx.`.
- B2 (HIGH): `PATCH /api/quotes/[id]` "quote" action rejects
  suppliers whose status is not APPROVED or publicVisible is false.
- B7: bank last-4 in audit metadata replaced with first-8-hex of
  sha256(last4); diff visibility preserved, digits no longer leak.
- B8: `POST /api/applications` rejects new applications from an
  email whose SUPPLIER User has a SUSPENDED Supplier.
- B9: `/api/cron/connect-sync` MAX_PER_RUN=200, ASC by id, hasMore
  in response. Mirrors PLH-2 Phase 4e pattern.
- B10: `PATCH /api/admin/suppliers/[id]` go-live flip wrapped in
  `$transaction` so the readiness inputs cannot race the update.

Drops: B1 (already gated via effectiveAccessToSupplier), B3 (real
fix needs optimistic concurrency; backlog), B4 (supplier's own data,
no tenant crossing), B5 (Shippo freightSource surfacing needs schema
changes; backlog), B6 (surcharge trust needs address API; deferred).

No new migrations. **Cumulative across all rounds: 28 CRITICAL + 62
HIGH closed.** Every `npx next build` since P12 has compiled clean.

**PLH-3g (2026-05-26).** Multi-supplier refactor across 9 phases on
the same branch. The launch-time single-supplier-cart constraint is
RESOLVED. Buyers can now place a cart spanning N suppliers; the Order
splits into N `OrderSupplierSlot` rows, each with its own subtotal /
freight / fee / refunded counters, per-supplier payment-intent
transfer via Stripe Connect, per-supplier shipment dispatch
(carrier / tracking / shipmentStage / shippedAt / deliveredAt at the
slot level), and per-supplier refund clawback. Phases:
- P1: `OrderSupplierSlot` schema + hand-authored migration
  `20260608000000_add_order_supplier_slot`.
- P2: cart / checkout client guard removed; per-supplier grouping in
  the UI.
- P3: `POST /api/orders` creates one slot per supplier in the same
  `$transaction`; slot math reconciles to the Order row totals.
- P4: `markOrderPaid` + payouts iterate per slot; 3-stage payout
  per supplier.
- P5: per-supplier shipment dispatch; slot-level tracking columns +
  migration `20260608010000_add_order_supplier_slot_shipment_fields`.
  Admin per-slot ship UI flagged deferred (see backlog below).
- P6: per-supplier refund routing; slot/item-scoped refunds clawback
  only that supplier.
- P7: buyer `/orders/[id]` + invoice + email render per-supplier
  sections.
- P8: supplier dashboard scoped to its own slot. Admin per-slot ship
  UI re-flagged deferred.
- P9: multi-supplier e2e seed scenario at stable reference
  `PP-MULTI1` (Relay & Protection Partners + Gridline Power Supply,
  one PAID order, 2 OrderSupplierSlot rows, Invoice row). Per-supplier
  slot math extracted into `computePerSupplierSlots()` in
  `src/lib/order-totals.ts` so the route and future tests share the
  same code path. No Vitest infra installed at this round, so no
  test files landed (extraction is the test-readiness artifact).

Migrations new in PLH-3g:
- `20260608000000_add_order_supplier_slot`
- `20260608010000_add_order_supplier_slot_shipment_fields`

Every `npx next build` across PLH-3g P1..P9 has compiled clean.
Zero em dashes throughout.

**Cumulative across all rounds, including PLH-3g: 28 CRITICAL + 62
HIGH closed, plus the single-supplier-cart constraint lifted.**

## Inbound email feature: LIVE + smoke-proven on prod (2026-05-26)

The Resend webhook is configured and pointing at
`/api/email/inbound`. The domain `reply.partsport.agentgaming.gg` is
verified for both send and receive (Cloudflare DNS, AWS SES inbound
MX live, all four records: DKIM TXT, SPF MX + TXT, inbound MX, DMARC
TXT).

PLH-3d shipped the Svix v1 verifier at `7c5ec7f`, so `verifyAuth()`
now matches Resend's signed-header format. All four Vercel env vars
are set in Production + Preview:
- `INBOUND_EMAIL_PROVIDER=resend`
- `INBOUND_EMAIL_DOMAIN=reply.partsport.agentgaming.gg`
- `INBOUND_REPLY_SECRET` (HMAC key for the per-thread Reply-To token)
- `INBOUND_WEBHOOK_SECRET=whsec_*` (Svix signing secret from Resend)

Empty deploy commit `c9901cd` pushed to force the env vars into the
running deployment. The webhook signing secret stays mirrored in
`C:\Users\radfe\rok-preview\.local-secrets.env` (gitignored) for
disaster recovery; rotate via the Resend dashboard if it ever leaks.

**Code path smoke-proven on prod 2026-05-26.** POSTing a Svix-signed
payload to the deployed `/api/email/inbound` returns
`200 {"ok":true,"ignored":"no reply token"}`, confirming: provider
check passes, Svix v1 signature verifies, reply-token parse reached
and correctly skips a non-reply `to:` address. The full email
round-trip (real outbound thread email + buyer replies + Resend
inbound parse + Message row + fan-out) still requires a physical
inbox test, but the code-side is fully proven.

**Note from this round:** the three pre-existing INBOUND_* env vars
(EMAIL_PROVIDER, EMAIL_DOMAIN, REPLY_SECRET) had empty values when
the orchestrator chat checked them. Some prior chat had created the
env-var rows without populating them. Orchestrator overwrote all
four via the Vercel dashboard with the correct values, pushed two
empty deploy commits (`a6947c4`, `c77d2a9`) to force a rebuild, and
ran the smoke. Lesson for future cutovers: never trust an "Encrypted"
env-var listing alone, always verify the value loads at runtime via
either a smoke endpoint or a deploy log line.

## Launch-time decisions

**Single-supplier carts. RESOLVED by PLH-3g (2026-05-26).** The
constraint that limited a cart to one supplier at soft launch is gone.
PLH-3g landed the full multi-supplier refactor across 9 phases: one
Order, N `OrderSupplierSlot` rows, per-supplier payment-intent splits
via Stripe Connect destination charges, per-supplier shipment dispatch
(slot-level carrier / tracking / shipmentStage / shippedAt /
deliveredAt), per-supplier refund clawback, buyer + supplier + admin
UI scoped per slot, per-supplier order emails. See the PLH-3g block in
the audit-rounds section above for phase-by-phase detail.

## Post-launch backlog (deferred from PLH-3g multi-supplier refactor)

- **Admin per-slot ship UI.** Flagged in PLH-3g P5 and re-flagged in
  P8. Admins can already see per-slot ship state via the supplier
  dashboard view of each slot, but `/admin/orders/[id]` does not yet
  expose a per-slot Ship button for the admin-on-behalf-of-supplier
  case (admin marking a slot Shipped when a supplier is unreachable).
  Backend code path (`markSlotShipped`) is in place; this is a UI
  surface only.

## Pre-launch polish roadmap (Polish 6 → 11) — COMPLETE

All polish rounds shipped and verified. Final PageSpeed Mobile: Performance 92 / Accessibility 100 / Best Practices 100 / SEO 100. First Load JS = 102 kB.

**Polish 6 — Supplier onboarding. DONE.** Legal docs upload + admin review, bank info collection via Stripe Connect, 10-item onboarding checklist that gates publicVisible. Required before any real supplier can transact.

**Polish 7 — Trust + legal. DONE.** Legal page bodies (ToS, Privacy, Acceptable Use, Returns, Supplier Agreement). Email verification on signup. Sentry error tracking. Audit log for admin mutations at `/admin/audit`. Account recovery flows. Production rate limiting via Upstash Redis.

After Polish 7 landed, the platform gained a structured debugging surface: `/admin/audit` shows every admin mutation with actor, target, summary, and a JSON metadata bag. When a test chat reports "X is broken after Y did Z," the audit log is the first place to look. The data lives in the `AuditLog` table; the helper `writeAuditLog()` in `src/lib/audit.ts` is wired into every admin route.

**Polish 8 — Money operations. DONE.** Stripe Connect Express for automated supplier payouts. Real Stripe refund flow. 5% chargeback reserve. Daily reconciliation cron Stripe ↔ PartsPort DB. Reserve-release, payout-retry, health-check crons. Tax registration tracking. Profit dashboard at `/admin/profit`. Refund clawback netting via `owedToPlatformCents`.

**Polish 9 — Real freight. DONE.** Shippo integration for real-time LTL freight rates. Product weight/dimensions/freight class. SupplierWarehouse model for origin zips. Multi-shipment splits across suppliers. Freight surcharges (liftgate, residential, inside delivery). Label printing on dispatch via Shippo (UPS active, FedEx unavailable).

**Polish 9.5 — Audit fixes. DONE.** CRON_SECRET fail-closed in production. Server-trusted freight pricing (rejects bogus rate IDs). Order idempotency via Idempotency-Key header. Refund clawback netting. Webhook idempotency by stripeRefundId. Manufacturers public-filter on product groupBy. Email-verify gates on quotes/returns/reviews. Audit-log gap fills.

**Polish 9.6 — HIGH fix. DONE.** Idempotency lookup before rate-limit consume on POST /api/orders.

**Polish 10 — SEO + performance. DONE.** Per-page metadata + Open Graph + Twitter cards. JSON-LD structured data on products, brands, home. Canonical URLs via `siteUrl()` helper. Next.js Image component everywhere. Sitemap + robots. Lighthouse SEO 100, BP 100, A11y 95.

**Polish 11 (and 11.5 → 11.10) — Analytics + a11y + mobile + LCP + UI integrity. DONE.** Vercel Analytics + Speed Insights mounted. WCAG AA contrast pass (Accessibility 100). Mobile filter toggle. 44px tap targets. next/font self-hosted for Hanken + Plex Mono. Sentry pruned from client bundle entirely (window listeners → /api/error-log → server SDK). Route-scoped CSS splitting (legal, manufacturer, admin extracted from globals.css). 32 of 37 UI flaws from the visual audit fixed across 5 critical, 12 high, 13 medium, 7 low items. Hanken italic dropped. Image transcode quality 65.

The two not-fixed UI items from P11.7 were a breakpoint consolidation (deferred — needs screenshot QA) and a 565-site inline-fontSize sweep (utility classes added, mechanical refactor deferred).

After Polish 11 verified clean, Rad's task list moves to real-world verification (email delivery, Stripe Connect real onboarding, Shippo UPS labels, RFQ-to-order conversion, returns flow, the 4 daily crons running for real, refund clawback) and production cutover (wipe demo seed, THRADD onboards, first real test order, attorney review, real photos, custom domain, optional brand rename, Stripe live mode flip).

Each polish round was a self-contained punch list. Rad pasted one round at a time to a fresh PartsPort build chat (swapping every 60-80 commits to avoid context bloat). Orchestrator verified after each round, wrote the next punch list, swapped chats as needed.

The ship-ready playbook (with click-by-click pre-launch verification steps and the production cutover order) lives in the orchestrator chat and in `LAUNCH_PLAN.md`.

## Post-launch backlog (deferred from PLH-2 Phase 4a CSV-import audit)

These are MEDIUM/LOW catalog-import findings explicitly skipped at PLH-2 Phase 4a. The Phase 4a commit closed the six CRITICAL/HIGH items (A1 transactional bulk writes with batched rollback, A2 compound SKU ownership where + P2002 row error, A3 rate limits on /api/supplier/catalog-import and /api/supplier/catalog-cleanup with a tighter 10/hour catalog-cleanup bucket, A4 2 MB server-side size cap with 413, A5 BOM strip in parseCsv, A6 csvSafeCell formula-injection prefix across all CSV export routes). The list below is queued for a post-launch polish round, not for soft launch.

- **Price precision.** `normalizeRow` uses `Number()` then `dollarsToCents()`; rows with five decimals or scientific notation can lose pennies. Prefer a string-based parse that rejects non-currency input and keeps two decimals exactly.
- **Stock coercion.** `Number(raw.stock || "0") || 0` silently maps any garbage value to 0. A row reading "out of stock" should error, not pretend to be 0 stock.
- **imageUrl validation.** No protocol or length check today. Any string is accepted and written into ProductImage.url and Product.imageUrl. Should validate it parses as an http(s) URL and is under say 2 KB.
- **etaDays clamp.** Currently `Math.max(1, ...)` only; no upper bound. Caps to something sane (90?) so a typo of `999999` does not poison search filters.
- **quoteOnly heuristic.** `price >= 3000` default is reasonable but invisible to the user. Surface in the preview table so they can confirm before commit.
- **Description fallback.** `${r.name} supplied by ${supplier.name}.` writes the supplier name as authored text, not data. Move to a runtime template or store empty + render the fallback at read time so a supplier rename does not require a backfill.

## Post-launch backlog (deferred from PLH-2 Phase 4c OEM-storefront audit)

These are MEDIUM/LOW findings explicitly skipped at PLH-2 Phase 4c. The Phase 4c commit closed the four CRITICAL/HIGH items (C1 magic-byte sniff + safeExt on OEM logo upload, C2 SVG removed from OEM logo allow-list to kill the public-storefront XSS vector, C3 rate limits on `/api/oem/profile` PATCH and `/api/oem/profile/logo` POST keyed on `oem:${user.id}`, C4 strict URL parse + http(s) protocol check + 200-char cap on `manufacturerWebsite`). The list below is queued for a post-launch polish round, not for soft launch.

- **OEM approval gate.** Anyone signing up as MANUFACTURER can immediately edit a public storefront. Add an admin-approval step (similar to SupplierApplication) so brand pages are not stood up by impostors.
- **Brand uniqueness DB constraint.** `User.manufacturerName` has no unique index. Two OEM accounts can claim the same brand name and race for the slug. Add a partial unique index `(manufacturerName) WHERE role = 'MANUFACTURER'`.
- **Slice / trim edge cases.** `tagline.slice(0, 140).trim()` can produce a string shorter than 140 chars and then a different-length string after trim; user-visible character count drifts. Trim first, then slice.
- **Blob path leaks user id.** `oems/${user.id}/logo.${ext}` exposes the OEM's User id in the public blob URL. Use a hash or per-OEM random suffix instead.

## Post-launch backlog (deferred from PLH-2 Phase 4d address-book + notif-prefs audit)

These are MEDIUM/LOW findings explicitly skipped at PLH-2 Phase 4d. The Phase 4d commit closed the four CRITICAL/HIGH items: D1 (per-user notification preference flags `notifyOrderEmails` / `notifyMarketingEmails` / `notifyProductUpdates`, `shouldSendToUser` gate, /settings Notifications card, PATCH `/api/account/notification-preferences` rate-limited + auth-gated, RFC 8058 List-Unsubscribe header on outbound mail, public signed-token `/api/email/unsubscribe`), D2 (per-user `rateLimit("generic", user:${id})` on /api/addresses POST + /api/addresses/[id] PATCH/DELETE + /api/addresses/[id]/tax-exempt POST/DELETE), D3 (per-field length caps in `validateAddress`, structured `{ field, error }` 400), D4 (ISO alpha-2 country regex, per-country postal regex US/CA/GB + generic fallback, tax-exempt blob flipped to `access:"private"` with new auth+audit `/api/addresses/[id]/tax-exempt/download` route, `detectMagic` MIME sniff with PDF/JPEG/PNG only, SVG removed, https-only URL-paste). The list below is queued for a post-launch polish round, not for soft launch.

- **Address bound on quantity.** Buyers can create unlimited saved addresses; add a hard cap (e.g. 25) before insert.
- **Soft-delete addresses referenced by historical orders.** Today `DELETE` removes the row; if an old order embedded an Address relation we lose denorm history. Mirror the Supplier soft-delete pattern.
- **Phone format validation.** Phone is capped but not format-checked; a libphonenumber parse would catch obvious typos.
- **List the unsubscribed user a re-subscribe affordance in the unsubscribe response HTML.** Currently they have to find /settings on their own.
- **Tax-exempt cert expiry.** Resale certs expire (1-3 years depending on state); add an `taxExemptExpiresAt` column and admin reminder cron.

## Post-launch backlog (deferred from PLH-2 Phase 4e crons audit)

These are MEDIUM/LOW findings explicitly skipped at PLH-2 Phase 4e. The Phase 4e commit closed the five CRITICAL/HIGH items: E1 (auto-deliver routed through `isAuthorizedCronRequest` so prod fails closed when CRON_SECRET is unset), E2 (auto-deliver no longer swallows email failures; new `AUTO_DELIVER_EMAIL_FAILED` audit + `Order.deliveryEmailSentAt` timestamp + Sentry on `sendOrderDelivered` throw), E3 (reserve-release two-stage so the Stripe transfer fires AFTER the row is staked out but BEFORE `reserveBalanceCents` is decremented; new `status` column on `SupplierReserveTransaction` with PENDING/COMPLETED/FAILED lifecycle and stage-3 re-read + Math.min on fresh balance), E4 (`MAX_PER_RUN=200` cap on auto-deliver and reserve-release, ASC ordering by oldest first, `hasMore` in response payload), E5 (`ReconciliationState` singleton with `cursor` column; reconcile now walks forward in 7-day chunks one window per invocation with 1000/1000 charges+transfers caps, advances cursor only on a non-capped run). New migration: `20260604000000_plh2_phase4e_cron_audit`. The list below is queued for a post-launch polish round, not for soft launch.

- **Apply MAX_PER_RUN to remaining crons.** Phase 4e capped auto-deliver and reserve-release. The other cron loops (anonymize-deleted-accounts, cleanup-unverified-accounts, connect-sync, payout-retry, health-check) iterate users/suppliers/payouts unbounded. A first-run-after-outage backlog on any of them could still time out the Vercel function. Add a 200-per-run cap with ASC-by-creation ordering and a `hasMore` field.
- **Reconcile mismatch dedupe.** When a capped run replays the same window, the same mismatch can be written multiple times to AuditLog. Add a unique index on `(action, targetId, metadata->>'kind', metadata->>'windowStart')` or a check-then-write to suppress duplicates.
- **Reserve-release orphan cleanup.** A PENDING `SupplierReserveTransaction` whose process died between Stage 1 and Stage 3 (and where the Stripe transfer either landed or did not) will never resolve on its own. Add a sweeper that flags PENDING rows older than 1 hour with a metadata note for admin review.
- **Auto-deliver email retry surface.** `AUTO_DELIVER_EMAIL_FAILED` rows currently require an admin to manually re-notify the buyer from `/admin/audit`. A small "resend delivery email" button on the order detail page would close the loop.
- **Reconcile cursor admin view.** No UI surfaces the current cursor; a long backlog is only visible via the JSON response. Add a small card on `/ops` showing cursor + window + `hasMore`.

## Project context

PartsPort is a B2B industrial parts marketplace on `claude/industrial-marketplace-ROwAU`. Three user types beyond admin: buyers (free), suppliers/distributors (6% fee), OEMs/manufacturers (free, no direct sales). RFQ flow for big-ticket items. Stripe Checkout + Stripe Tax. Resend for email.

Deploy URL: `https://rok-preview-git-claude-industrial-marketplace-rowau-agentrad.vercel.app`

Demo accounts (password `demo1234`):
- `buyer@partsport.example` — Jordan Buyer
- `supplier@partsport.example` — Sam Rivera (Summit Power Systems)
- `admin@partsport.example` — Avery Ops
- `oem@partsport.example` — Siemens manufacturer

The full how-Rad-works brief is in `HABITS.md`. The testing team brief is in `docs/TEAM_TESTING.md`. Read both before you start.

## Tone

Match Rad's energy. He types casual and fast, he wants direct answers. Skip preambles. Give him the answer first, then the reasoning, then what to do next. Don't apologize for things that don't need apologizing for.

When something is genuinely a big deal — a working Stripe payment, a closed punch list, the platform clearing the launch bar — say so plainly. Don't undersell wins. Don't oversell either.
