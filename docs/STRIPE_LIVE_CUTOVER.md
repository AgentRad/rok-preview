# Stripe Live-Mode Cutover

The exact clicks to flip PartsPort from Stripe test mode to live mode.
~5 minutes if you have nothing in the way. Do this only when ready to
accept real money.

**Prereq:** Stripe account is verified with EIN, bank account
connected, identity verification passed. If any of those aren't done,
finish them first at https://dashboard.stripe.com (top right → toggle
to test mode is irrelevant; verification lives under Settings →
Business / Banking).

---

## 1. Toggle Stripe dashboard to Live mode

Open https://dashboard.stripe.com. Top-right corner has a "Test mode"
toggle. Flip it OFF. Page reloads; you're now in live mode. The URL
will no longer include `/test/`.

## 2. Copy three keys from Live mode

In the live-mode dashboard:

- **Settings → Developers → API keys** (or the URL
  https://dashboard.stripe.com/apikeys):
  - Copy the **Publishable key** (starts `pk_live_...`)
  - Reveal + copy the **Secret key** (starts `sk_live_...`)
- **Settings → Developers → Webhooks** (or
  https://dashboard.stripe.com/webhooks):
  - The existing test-mode webhook does NOT carry over. Click **Add
    endpoint**.
  - Endpoint URL:
    `https://rok-preview-git-claude-industrial-marketplace-rowau-agentrad.vercel.app/api/payments/webhook`
    (or the new domain once the rebrand cutover happens)
  - Events to send: `checkout.session.completed`, `charge.refunded`,
    `account.updated`, `transfer.created`, `transfer.updated`,
    `transfer.reversed`
  - Click **Add endpoint**, then on the endpoint detail page click
    **Reveal** under "Signing secret" and copy it (starts `whsec_...`)

## 3. Confirm Stripe Tax is active in live

- **Settings → Tax** (https://dashboard.stripe.com/settings/tax)
- Confirm "Active" status with at least one state registered
- If you haven't registered any state yet, do it now. Add the state(s)
  PartsPort has nexus in (likely Florida + any state with a real
  supplier address). Use the "Add registration" button.

## 4. Confirm Stripe Connect Tax Forms is enabled

- **Settings → Connect → Tax forms**
  (https://dashboard.stripe.com/settings/connect/tax-forms)
- Confirm 1099-K issuance is ON. This handles the year-end 1099 for
  any supplier crossing $600 GMV.

## 5. Paste keys into Vercel

Tell the orchestrator chat "set Stripe live keys" with the three values
copy-pasted, OR do it yourself at
https://vercel.com/agentrad/rok-preview/settings/environment-variables.

The three env vars to update (Production AND the
claude/industrial-marketplace-ROwAU Preview branch):

| Env var | New value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` from Step 2 |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_...` from Step 2 |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` from Step 2 |

If any test-mode value exists for those keys today, OVERWRITE it.
Don't add a second row.

## 6. Trigger redeploy

After the env vars are saved, an empty commit forces a fresh build:

```
cd C:\Users\radfe\rok-preview
git commit --allow-empty -m "deploy: pick up Stripe live keys"
git push origin claude/industrial-marketplace-ROwAU
```

Or the orchestrator chat does it for you.

## 7. Smoke test

After the new deploy is Ready (~90s):

- Hit the live preview URL, log in as `admin@partsport.example`.
- Go to `/admin/profit`. Confirm the page loads without errors (a
  Stripe API call happens server-side; if keys are wrong the page
  errors).
- Go to `/admin/health-check` if it exists, or trigger the daily
  health-check cron manually via `vercel cron trigger` if needed.
- In the Stripe live-mode dashboard, **Developers → Webhooks → your
  new endpoint**, click "Send test webhook" with event
  `checkout.session.completed`. Confirm the response is 200 in the
  webhook log.

## 8. Place the first real test order

Per `LAUNCH_PLAN.md` Section 9:
- Use a known supplier and a known buyer (THRADD + one of Conrad's
  buyer contacts)
- Smallest possible parcel-shippable item
- Walk the whole loop: supplier lists → buyer orders → ACH payment →
  real freight booked → tracking captured → delivered → supplier paid
  → invoice generated
- Sit with both companies. Every hesitation is feedback worth more
  than the order itself.

## Rollback path

If anything breaks in live mode, you can immediately fall back to test
mode by re-pasting the test-mode keys into Vercel and redeploying.
The Stripe data on the live account stays intact. No data is lost.

Keep a local backup of both sets of keys (live + test) in a password
manager. Never paste them into chat. The orchestrator chat will
generate a `.local-secrets.env` mirror if asked.
