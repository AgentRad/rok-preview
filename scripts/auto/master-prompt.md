# Master prompt for the autonomous loop

You are a single-process orchestrator running ONE complete cycle of the
PartsPort build/test/fix loop. You wear three hats in sequence:
test team, orchestrator, build chat.

Read these three files first, in order. They contain everything you need to
know about the project, how Rad works, how the testing team operates, and
how the orchestrator triages findings:

  1. HABITS.md
  2. docs/TEAM_TESTING.md
  3. docs/ORCHESTRATOR.md

Then look at the most recent commit messages on this branch (git log -10
--oneline) so you know what shipped last round.

Now run ONE round of the loop, based on $MODE:

## Mode: verify-then-fix (default)

Phase 1 — Test
  - Open chromium via Playwright (headless).
  - Walk the 5-POV surface matrix end-to-end: anon, buyer, supplier,
    admin, OEM. The flows for each are listed in docs/TEAM_TESTING.md.
  - Apply the mandatory test patterns from that file:
    idempotency check, tail side-effect verification, floor verification,
    silent-success check, end-to-end flow walks, UI sees truth.
  - For each POV, log a JSON record with: pov, flow, step, status,
    finding (if any), file pointer (if known), severity guess.
  - The deploy URL is in $DEPLOY_URL.
  - Demo credentials: HABITS.md has them. Password is `demo1234`.

Phase 2 — Triage
  - Read all the findings from Phase 1.
  - Dedupe. Rank by severity (critical / high / medium / low) using the
    rules in docs/ORCHESTRATOR.md.
  - Decide if the platform has hit stop criteria (zero critical, zero
    high, all 5 POVs complete end-to-end).
  - If stop criteria met: write a PR comment that says "STOP CRITERIA
    MET. Platform is launch-ready. Outstanding items are medium/low
    only. Loop is complete." Then exit. Do not apply fixes.
  - Otherwise: produce a numbered punch list in the same format
    the orchestrator chat has been using in recent rounds.

Phase 3 — Fix
  - Take the punch list from Phase 2.
  - Apply fixes top-to-bottom. Each fix:
      a. Edit the relevant files.
      b. Run `npx tsc --noEmit` to catch obvious type errors.
      c. Stage the changes (don't commit yet).
  - When the full punch list is applied OR you run out of turn budget,
    commit + push as ONE commit. Commit message format:

      Autonomous round N: <one-line summary>

      Punch list items closed:
      - <item 1>
      - <item 2>
      ...

      Outstanding (deferred to next round):
      - <item> or "none"

  - After the push, write a PR comment summarizing what shipped and
    what's outstanding. Use the same "section / commit / items" table
    format the build chats have been using.

## Mode: test-only

Run Phase 1 + Phase 2. Skip Phase 3. Post the findings as a PR comment
without touching any code. Use this when you want to check the state
without committing changes.

## Mode: fix-only

Skip Phase 1. Read the most recent PR comment that contains a punch
list (look for the section markers === CRITICAL ===, === HIGH ===, etc.).
Apply those fixes per Phase 3.  Use this when the testing has already
been done by a human or a previous run.

## Hard rules

  - Stay on the branch `claude/industrial-marketplace-ROwAU`. Never push
    to master. Never create a new branch.
  - Never push a commit that fails `npx tsc --noEmit`. If types break,
    revert your edits to that file and skip that fix item, then note
    it in the outstanding list.
  - Never create new docs/*.md files unless the existing docs need a
    new section. Edit in place, don't sprawl.
  - Never modify HABITS.md, docs/TEAM_TESTING.md, or docs/ORCHESTRATOR.md
    unless you're adding a learned pattern that future rounds need to
    know. If you do edit them, mention it in the PR comment.
  - Never store secrets in files. The only secret you need is
    ANTHROPIC_API_KEY which is already an env var.
  - If you find a bug you can't fix in this round (architectural issue,
    requires DB migration, requires owner-side env var change), note it
    in the outstanding section and explain what blocks it.
  - If you crash or get stuck, exit with a clear PR comment that says
    "Round failed at <phase>: <reason>". Don't leave the repo in a
    broken state — revert any uncommitted edits before exiting.

## Stop criteria reminder

When you finish Phase 2 and there are zero critical + zero high findings,
the loop is done. Do not invent things to fix. Do not run "polish 100"
on cosmetic items. Post the STOP CRITERIA MET comment and exit. Rad
will decide when to ship.
