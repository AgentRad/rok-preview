# Multi-Agent Site Testing — How to Run It

A team of Claude sub-agents that opens browsers, walks the site as different users, and reports what works and what's broken. One orchestrator agent coordinates, dispatches the team in parallel, and consolidates findings.

## What the team does

Five testers run in parallel, one per user POV:

1. **Anonymous tester** — Browses catalog, searches, opens product pages, tries to add to cart, hits register and login. Reports broken links, missing photos, 500s, dead end flows.
2. **Buyer tester** — Logs in as `buyer@partsport.example`, completes the buy loop (search → product → cart → checkout → pay → order detail → message thread → review). Reports anything that breaks the path from intent to fulfillment.
3. **Supplier tester** — Logs in as `supplier@partsport.example`, walks the supplier dashboard (catalog import, RFQ response, ship order, mark delivered, payout view, team invite). Reports anything broken on the seller side.
4. **Admin tester** — Logs in as `admin@partsport.example`, exercises the admin console (approve application, advance ops board, review tax-exempt cert, view invoices, run impersonation). Reports anything that blocks admin from doing their job.
5. **OEM tester** — Logs in as `oem@partsport.example`, reviews the manufacturer dashboard (storefront, demand signals, authorized distributors). Reports anything that doesn't match the OEM value proposition.

The orchestrator collects all five reports, deduplicates findings, and writes a single prioritized punch list.

## How to invoke

In any Claude Code session on this repo, say:

```
Run the testing team. Five POVs in parallel. Use Playwright. Report back.
```

Claude will:
1. Spawn five sub-agents with the Task tool, one per POV, in a single message (so they run concurrently).
2. Each agent uses Playwright MCP (or the equivalent) to open a real browser, run its assigned flow, take screenshots at each step, and capture any console errors.
3. Each agent returns a structured report: passed steps, failed steps, screenshots, issues found, suggested fixes.
4. The orchestrator consolidates: critical bugs first, polish issues last, with file paths and proposed code changes where obvious.

## Required tools (one-time setup)

For the agents to drive real browsers, the environment needs Playwright. In Claude Code:

```bash
npx playwright install chromium
```

Or use the Playwright MCP server if available:

```bash
claude mcp add playwright npx @modelcontextprotocol/server-playwright
```

If neither is available, the agents fall back to `curl` + HTML inspection (less complete but still useful — that's what we used earlier in this project).

## Running offline (local Claude Code)

To run this on your own machine without depending on the cloud:

1. Install Node.js (https://nodejs.org) and git on your machine
2. Install Claude Code:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
3. Clone the repo locally:
   ```bash
   git clone https://github.com/AgentRad/rok-preview
   cd rok-preview
   git checkout claude/industrial-marketplace-ROwAU
   ```
4. Install Playwright:
   ```bash
   npm install
   npx playwright install chromium
   ```
5. Launch Claude Code:
   ```bash
   claude
   ```
6. Use the same prompt: `Run the testing team. Five POVs in parallel. Use Playwright. Report back.`

You'll see the browsers open on your screen, watch the agents click through the site, and get the same consolidated report. Local mode is great because you can SEE the testing happen.

## What the orchestrator returns

A single report shaped like this:

```
=== Testing Summary ===
Total flows tested: 5
Critical issues: 3
Polish issues: 7
All-green flows: 2

=== Critical (fix today) ===
1. [Buyer] Checkout redirects to PayPal even when Stripe configured
   File: src/lib/payments.ts:42
   Fix: prefer stripe provider when STRIPE_SECRET_KEY present
   
2. [Anonymous] Pagination "Next →" button broken on page 3
   File: src/app/catalog/page.tsx:280
   Fix: hrefWith({page: String(page + 1)}) drops trailing slash

...

=== Polish (next sprint) ===
1. [Supplier] No empty-state illustration on "No orders yet"
2. [Admin] Tax-exempt review card missing the cert PDF preview
...

=== Green flows (no issues) ===
- [OEM] Demand signals dashboard
- [Anonymous] Search and category filtering
```

## When to run it

- Before any deploy that touches checkout, payments, or auth
- After any database schema change
- Weekly as a regression sweep (set up a cron in Claude Code's `loop` skill)
- On demand when you suspect something broke

## Tuning the testers

Edit this file to change what each tester checks. The orchestrator reads this doc to brief each sub-agent — add a bullet here, that flow gets tested next time. Remove a bullet, it's dropped.

Custom flows can be added too. To add a sixth tester (e.g. "QA tester who tries to break things"), add a section here and rerun. The orchestrator will pick it up automatically.

## Why this setup

- **Parallel** — five testers run at the same time, total wall-clock time is one tester's worth, not five
- **Reproducible** — every tester has the same brief in this file, no drift between runs
- **Honest** — agents drive real browsers, so they see what a real user sees
- **Cheap to evolve** — change one bullet here, change the test

## Mandatory test patterns (learned the hard way)

These checks must run every round. Each one caught a real bug that previous rounds missed.

**Idempotency check.** For every state-changing endpoint, POST it twice in a row. Verify the second call does not produce a second side effect (no duplicate emails, no duplicate DB rows, no duplicate notifications). If the API accepts the second call, that's a bug — fire it as a finding.

**Tail side-effect verification.** After any POST that triggers async work (emails, payouts, third-party API calls), wait 5 seconds, then independently verify the side effect actually happened. Read the DB row, check the Resend log, hit the endpoint that lists payouts. "200 returned" is not proof the work completed on Vercel serverless.

**Floor verification.** If the system promises a minimum (e.g. "search always returns at least 5 results"), test it at the boundary. Try queries that target small categories. Try queries that don't match anything at all. The promise must hold or the system must explicitly say "no results" — silent under-delivery is a bug.

**Silent-success check.** When a user submits data that doesn't match anything (a brand name that doesn't exist, an SKU that's been deleted, an address ID that's not theirs), the system must either reject with a clear error or surface a warning. Returning 200 with a phantom record is a bug. Test this for every user-input flow.

**End-to-end flow verification, not spot checks.** Walk the full flow for each POV from beginning to end. Don't just verify one fix — verify the fix didn't break the steps before or after it. Buyer flow goes register → login → search → product → cart → checkout → pay → order detail → message thread → tracking → invoice → reorder → review. All of it, every round.

**UI sees the truth.** After any state change, reload the page the user actually sees. A fix that updates the database but doesn't update the timeline / tracking card / status badge is incomplete. Verify the UI reflects the new state on first load, not after a refresh.

## How findings should be reported

Every finding needs three things or it's not actionable:

1. **What broke** — concrete, specific, in user terms. Not "search is bad", but "query 'meter' returns 4 results when floor is 5".
2. **Where it broke** — file path and line number when possible, or the endpoint and payload that triggered it.
3. **Why it broke** — root cause when you can identify it, not just the symptom.

The orchestrator chat triages by severity:
- **Critical** — a flow can't be completed (user can't buy, supplier can't ship, admin can't approve). Fix today.
- **High** — a flow is degraded (silent data corruption, missing notifications, broken auth on a sub-route). Fix this sprint.
- **Medium** — a polish item that affects the user experience but doesn't block a flow.
- **Low / cosmetic** — visual nits, copy issues, accessibility refinements. Address post-launch.

If a finding doesn't have a clear severity, default it to High — the build chat can downgrade if they disagree.
