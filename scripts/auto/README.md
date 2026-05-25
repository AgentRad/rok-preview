# Autonomous Fix Loop — Setup & Usage

This directory contains the Option 3 autonomous loop for PartsPort. Once
configured, it runs the build → test → fix cycle without a human in the
middle, on Sonnet 4.6, billed to your Anthropic account.

## One-time setup (Rad, you do this once)

You need to give the loop two things: an API key, and permission to push
to the branch. Both are clicks in GitHub.

### Step 1 — Get an Anthropic API key

1. Go to https://console.anthropic.com/settings/keys
2. Sign in with the same Anthropic account you use for chat.
3. Click "Create Key". Name it "PartsPort autoloop".
4. Copy the key (starts with `sk-ant-`). You only see it once. If you
   miss it, delete the key and make a new one.
5. Add billing if you haven't. Set a monthly spend limit at
   https://console.anthropic.com/settings/billing — recommended: $50
   while you're getting comfortable, $200 once you trust the loop.

### Step 2 — Add the key as a GitHub Secret

1. Go to https://github.com/AgentRad/rok-preview/settings/secrets/actions
2. Click "New repository secret".
3. Name: `ANTHROPIC_API_KEY`. Value: the `sk-ant-...` string from Step 1.
4. Click "Add secret".

That's it. The Action already has push permission via the default
GITHUB_TOKEN (configured in the workflow file).

## How to run one round

1. Go to https://github.com/AgentRad/rok-preview/actions
2. In the left sidebar, click "Autonomous fix loop".
3. Click "Run workflow" (top right of the runs list).
4. Pick a mode:
   - **verify-then-fix** (default): test the live deploy, triage findings,
     fix top items, commit + push. Use this for normal rounds.
   - **test-only**: test the deploy and post findings, no fixes. Use this
     when you want a status check without changing code.
   - **fix-only**: skip testing, apply the most recent punch list from
     PR comments. Use this when a human has already done the testing.
5. Click the green "Run workflow" button.
6. Watch the run in real time, or come back in 20-30 min when it's done.
7. When complete, check the PR for a new commit and a new comment
   summarizing what shipped.

## How to schedule it

The workflow file has a commented-out cron schedule. Once you've watched
a few manual runs and trust the loop, uncomment the `schedule:` block
in `.github/workflows/autonomous-loop.yml`. Default is every 6 hours.

## What the loop costs

Sonnet 4.6 pricing (input/output per million tokens) and rough per-round
estimates with Claude's prompt caching active:

| Round outcome             | Estimated cost |
| ------------------------- | -------------- |
| Test only, no findings    | $0.50 – $1.50  |
| Test + small fix batch    | $1.50 – $4.00  |
| Test + large fix batch    | $3.00 – $8.00  |
| Stuck loop (worst case)   | $20 (capped)   |

Hard caps on cost:
1. Each run has a 30-minute wall clock (timeout in the workflow file).
2. Each run has a 200-turn limit on Claude Code (--max-turns flag).
3. Your Anthropic billing limit (set in Step 1 above) is the ultimate
   ceiling — if the loop tries to spend past it, the API rejects calls
   and the loop crashes cleanly.

Realistic monthly cost during active dev: $20 – $80. After launch when
the platform is stable: $5 – $20.

## How to stop the loop

If a run is going sideways:
1. Go to the Actions tab.
2. Click the running workflow.
3. Click "Cancel workflow" (top right).

The loop will stop within 10 seconds. No partial commits get pushed
because the loop commits as one atomic operation at the end of each
round, not mid-fix.

If you want to permanently disable the loop:
1. Edit `.github/workflows/autonomous-loop.yml`.
2. Delete or rename the file.
3. Commit + push.

## How to know it's working

Each successful round produces:
- A new commit on the branch (from `PartsPort Autonomous Loop`).
- A new PR comment with the summary table.

If a run produces neither, check the workflow logs in the Actions tab —
the log will contain the master prompt's output, including any errors.

## When the loop says we're done

If a `verify-then-fix` round posts a comment that says
**"STOP CRITERIA MET. Platform is launch-ready."** — that's your signal
that all 5 POVs walk every flow end-to-end with zero critical and zero
high issues remaining. Read the comment carefully, do a manual click-
through of the deploy as a sanity check, and ship.

Once shipped, you can disable the schedule (or keep it on a slower
cadence like once a week) for regression sweeps as the codebase evolves.

## What the loop CANNOT do

Stuff that still needs you:
- Add environment variables in Vercel (Stripe keys, Resend, inbound email).
- Click buttons in third-party dashboards (Stripe Tax setup, DNS records).
- Make business decisions ("should we charge 4% or 6%?").
- Approve large architectural changes (the loop only does fixes, not
  refactors or new features).

The loop is good at: closing punch list items, fixing bugs found by
end-to-end testing, regression sweeps, small polish. It's not good at:
greenfield features, deciding what to build, anything involving real
users or real money.

## When to invoke me (the orchestrator chat) vs the loop

- Loop: "verify and fix bugs based on the existing test suite + docs"
- Orchestrator chat: "design a new feature", "decide what to build next",
  "review architecture", "write a new section of the docs"

If you find yourself wanting to give the loop strategic instructions,
that's a signal to talk to me first.
