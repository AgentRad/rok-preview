# scripts/

Local utilities and smoke-test helpers for PartsPort. Build artifacts
that don't ship to production live here.

## Rules

1. **Never hardcode secrets.** No API keys, session tokens, signing
   secrets, database URLs, cookies, or anything you would not paste
   into a public Slack channel. Read from `process.env` or
   `.local-secrets.env` (gitignored). If a script needs a value that
   does not have an env var yet, add the env var, do not inline the
   literal.
2. **Never commit a curl cookie jar.** `jar.txt`, `*.cookie-jar`,
   `cookies.txt` are all gitignored at the repo root, but a script
   that writes one to a non-standard path can still leak it.
   `SESSION_SECRET` has been rotated once already after exactly this
   slip; do not be the second.
3. **One-off probe scripts get deleted.** If a script is genuinely a
   throwaway (`probe-*.mjs`, `test-*.mjs`, `out.txt`), delete it after
   the question is answered. Long-lived scripts get a clear name and
   a top-of-file comment explaining when to run them.
4. **No production side effects from a script.** A `scripts/` file
   running on the workstation should not be able to write to the prod
   database or fire customer-facing emails. Default to the dev
   `DATABASE_URL`. If a script genuinely needs prod read access, make
   the env-var name explicit (`PROD_DATABASE_URL` and a banner that
   prints which one was loaded).

## What lives here today

- `screenshots.mjs` — Playwright capture of page renders for the
  design review pipeline.
- `topdf.mjs` — Render the `/orders/[id]/invoice` route to a PDF for
  attorney review and printing tests.
- `auto/` — The autonomous-loop bootstrap. See
  `scripts/auto/README.md` for that loop's specific contract.

## Smoke-test scripts

Smoke tests historically lived here too (probe the auth flow, hit a
private API route with a known-good cookie, etc.). The current set is
empty by design after a periodic hygiene sweep. When you bring one
back:

- Put it under `scripts/smoke/<name>.mjs`.
- Read every secret from env. Document the required env vars in a
  top-of-file comment.
- Print the env-var source (`process.env.NEXT_PUBLIC_SITE_URL ||
  'http://localhost:3000'`) so a future maintainer can read the log
  and immediately know which target the run hit.
- Use a short-lived auth cookie (`jose` JWT minted ad-hoc) over
  reading the real session jar where possible. If you must read a
  jar, write it to `jar.txt` (already gitignored) and `unlink` it on
  exit.

If a script ever leaks a token, rotate the affected secret in Vercel
immediately, push a no-op commit to force a redeploy, and add a note
to the rotation commit explaining what was exposed and for how long.
