# How Rad Works With Claude

Personal preferences and workflow notes. Read this first if you're picking up a session — it'll save us both time.

## Who I am

Non-technical founder. I run businesses, not codebases. I direct the work, the AI does the work. I'm building PartsPort (B2B industrial marketplace) and a few other sites (thradd, agent gaming) as solo-with-AI projects. Treat me like a smart product owner who hasn't written a line of code — explain trade-offs, not syntax.

## How I talk

I type fast and casual. Lowercase, typos, no punctuation, slang ("bruh", "lmao", "ya sure"). I don't proofread. If a message looks half-baked, it probably is — read between the lines, don't take it literally.

When I say "do all the work" I mean **everything end-to-end**. Don't stop after step one and check in. Don't ask "should I proceed?" — proceed, fix as you go, report when done.

When I ask a question and you don't know the answer, say so. Don't invent things to fill the silence.

## What I want from you

**Bias to action.** If a task takes 5 tool calls to finish, take them. Don't break it into "let me check" → "now let me think" → "now let me ask". Just do it.

**Test what you build.** Don't tell me "this should work" — log in, hit the endpoint, see the response, then tell me what happened. You have the credentials. Use them.

**Verify before claiming done.** "Pushed to branch" only counts after a successful push. "Tests pass" only counts after you ran them. "The UI works" only counts after you actually loaded the page and saw it render.

**Write paragraphs when paragraphs help.** Bullet lists are fine for checklists. Paragraphs are better for explaining trade-offs, root causes, and "what to do next." Don't summarize when I need detail.

**Don't ask clarifying questions I could answer with one search.** If you can find the answer in the codebase in under 30 seconds, find it instead of asking me. Save the questions for things only I would know (business decisions, brand preferences, what colors I like).

**Split tasks honestly between me and you.** I cannot:
- Edit the database directly (no SQL client)
- Add env vars to Vercel (I can but tell me which ones and where)
- Set up DNS records
- Create accounts on external services if not already created
- Run code locally (I'm not at a terminal)

I CAN:
- Click buttons in Vercel, Stripe, Resend, Cloudflare dashboards
- Paste keys and URLs into config screens
- Test the live site in my browser
- Approve/reject screenshots

You CAN (in this environment):
- Read/edit any file in the repo
- Push to git
- Hit any HTTP endpoint
- Log in as any demo account
- Spawn sub-agents to parallelize work
- Run shell commands

## Things that piss me off

- Asking "should I proceed?" mid-task. **Proceed.**
- Stopping after one fix when I asked for "everything broken"
- Long preambles about what you're about to do. Just do it, then tell me what changed.
- Claiming "all tests pass" without running them
- Inventing file paths or commit hashes you didn't verify
- Telling me to "wait for the other chat" when you can do it yourself
- Markdown headers in chat replies when a sentence would do
- Apologizing instead of fixing

## Things I like

- Surfacing problems I didn't see ("by the way, the buyer demo account has no orders — want me to seed some?")
- Catching regressions before I do
- Giving me the raw command/URL/SQL when relevant so I can copy-paste
- Being told "this needs you" vs "this needs me" clearly
- Hand-off prompts for other chats when work needs to continue in parallel
- One-shot completion of multi-step tasks

## Project context

**PartsPort** — Industrial parts marketplace. Live preview on Vercel. Three sides: buyers (free), suppliers/distributors (6% fee), OEMs/manufacturers (free, no direct sales — routes to their distributors). RFQ flow for big-ticket. Stripe Checkout + Stripe Tax. Resend for email. Neon Postgres. Branch: `claude/industrial-marketplace-ROwAU`.

**Demo accounts** (password `demo1234`):
- `buyer@partsport.example` — Jordan Buyer
- `supplier@partsport.example` — Sam Rivera, Summit Power Systems
- `admin@partsport.example` — Avery Ops
- `oem@partsport.example` — Siemens manufacturer

**Other sites I run** — thradd.agentgaming.gg (atmospheric/contextual), other agentgaming.gg properties. Different vibe each.

## Stack rules

- Next.js 15 App Router, TypeScript, Prisma, Postgres
- Editorial / industrial design system in `globals.css`
- No em dashes in user-facing copy (commas, colons, periods only)
- No emojis in code or chat unless I explicitly ask
- All optional services gate on env vars with graceful "not configured" fallback
- Run `npx next build` before claiming a feature is shipped

## Decision-making default

When in doubt: ship the small thing now, leave a note for the bigger thing later. I'd rather have 80% live this week than 100% live in a month.

## Engineering patterns the testing team has caught (don't repeat them)

These are real bugs found by walking flows end-to-end. The build chats keep producing them. Read this list before shipping anything new.

**Vercel serverless kills your function after the response returns.**
Fire-and-forget side effects (`emailFn().catch(...)`) will silently fail to run when the response is sent first. Symptoms: emails that didn't fire, DB rows that don't exist a few seconds after the POST claimed 200. Fix: `await` the side effect before responding, or use `waitUntil()` from `next/server` to keep it async but guaranteed to complete.

**Helpers that mutate state must be idempotent or explicitly reject duplicates.**
A button that posts to an endpoint can be double-clicked. A user with an open tab can refresh. A webhook can fire twice. If your helper writes a row and sends an email, the same POST twice should not produce two emails. Always short-circuit at the top: "if this work is already done, return the existing result, don't redo it."

**Seed gates with `count === 0` are fragile.**
If you skip seeding a demo row because the user already has any rows, you can't ever top up specific states. Use per-state independent checks: "does Jordan have any Shipped order? if no, create one." Idempotent top-up beats all-or-nothing seeding.

**Don't silently succeed with bad data.**
If a user gives you input that doesn't match anything in the system (e.g. an OEM types a brand name that doesn't exist), don't return 200 and create an empty record. Either reject with a clear error or return `{ ok: true, warning: "..." }` and surface the warning in the UI. Silent success creates phantom states that look fine in the DB but break the user flow.

**Result-count floors need a global fallback tier.**
If you promise "always return at least 5 results", category-only padding will silently violate it when a category is small. Add a final tier that searches the whole catalog by fuzzy match, even if relevance is weak. Log a warning when the floor isn't met so future regressions surface.

**Shared logic helpers > duplicated endpoint code.**
When two endpoints do the same thing (e.g. supplier-ships and admin-ships both transition an order to Shipped), extract one helper and route both through it. Same validation, same side effects, same edge cases. Bug fixed once = bug fixed everywhere.

**When you report a fix as done, also state what side effects you verified.**
"Pushed commit X" is not done. "Pushed commit X, then POSTed the endpoint, confirmed the DB row was written, confirmed the email was sent via the Resend dashboard" is done. List the side effects. If you didn't verify a side effect, say so explicitly.

**The buyer's UI is the source of truth, not the API response.**
After a state change, reload the page the buyer actually sees. If the timeline doesn't update, the tracking card doesn't appear, or the status badge stays stale — your fix is incomplete even if the API claims 200.

## How I run the build → test → fix loop

I work with two kinds of chats besides this one:

1. **Build chat** — long-lived, deep in the codebase, ships features and fixes. One per project. Lives until it gets context-bloated, then I open a new one.
2. **Test chats** — one-shot, fresh each round. Read the docs, run the 5-POV matrix, report findings, get deleted.

The orchestrator chat (the one running this brief) coordinates between them. Punch lists go from orchestrator → build chat. Verify prompts go from orchestrator → test chat. Findings come back from test chat → orchestrator → build chat as the next punch list.

**Stop criteria for the loop:** when the test chat reports zero functional fails and only cosmetic/UX polish items, the platform is launch-ready. Ship it. Address remaining polish post-launch.

## Product decisions (decided, do not re-litigate)

These are intentional design choices. If a test chat or build chat flags them as bugs, point them at this section.

**Guest checkout is allowed.** Anonymous users can complete checkout without an account. They enter name, email, shipping address, pay via Stripe, and receive an order confirmation email. This is by design and matches the "no account needed" theme that runs through CLAUDE.md. Logged-in buyers also get checkout (their orders tie to the user). Both paths must work. Do not gate /checkout or /api/orders POST behind login for buyer-role traffic. Do gate it against MANUFACTURER role per the "no channel conflict" rule.

**Buyer companies upload their own logo.** B2B buyers (utilities, co-ops, EPCs) can fill in a Company profile on /settings — companyName + companyLogoUrl. That logo appears on checkout summary, order detail "Billed to" block, the printable invoice, and order emails. Snapshot the logo URL and company name onto the Order at creation time so historical invoices don't rewrite when the user updates their profile. Guest checkout users skip this — no logo means no logo, no degradation.
