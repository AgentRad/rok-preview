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
