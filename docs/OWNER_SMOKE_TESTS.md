# Owner pre-launch smoke tests (PartsPort / THRADD)

These are the live tests only you can run. The whole platform was verified by code
review + unit tests + `npx next build`, never by a real click-through against a live
DB, inbox, Stripe, and IdP. These five tests catch the env / webhook / mobile class
of bug that code review structurally cannot reach. Run them top to bottom.

Live preview (serves the public site today):
https://rok-preview-git-claude-industrial-marketplace-rowau-agentrad.vercel.app

Demo logins (password `demo1234`): `buyer@partsport.example`,
`supplier@partsport.example`, `admin@partsport.example`, `oem@partsport.example`.

Each test below lists: PREREQ (what must be set first), STEPS, and PASS (what you
must see). If any PASS line fails, stop and paste me what you saw.

---

## TEST 0 (do this first): deploy + confirm the migration applied

WHY: a pending migration `20260713000000_add_last_totp_step` (TOTP anti-replay
column) applies during the Vercel build via `prisma migrate deploy`. Until the
branch redeploys, login-2fa would error on the missing column.

STEPS:
1. In Vercel, open the `rok-preview` project, Deployments tab, find the latest
   deploy of branch `claude/industrial-marketplace-ROwAU` (HEAD should be the
   latest commit).
2. Confirm it shows Ready (green), not Error.
3. Open the build log, search for `migrate deploy`, confirm the migration
   `20260713000000_add_last_totp_step` is listed as applied (no migration error).

PASS: latest commit deployed green AND the migration applied in the build log.
If the deploy is red, paste me the build-log error.

---

## TEST 1: Buyer-org flow (punch list 13)

PREREQ: email sending works (RESEND_API_KEY is set in Vercel = yes).
STEPS:
1. Log in as `admin@partsport.example`. Go to `/admin/buyer-orgs`, create an org
   (any name).
2. Open the org, add `buyer@partsport.example` as a member, then invite a NEW
   email you control (one you can check).
3. Confirm the invite email arrives in that inbox.
4. Open the invite link in a private window, accept it (register if prompted).
5. Log in as that new user. Confirm the org switcher appears in the header and
   that switching orgs persists across a page reload.

PASS: invite email arrives; acceptance creates membership; org switcher shows and
persists. FAIL signals: no email (sending/env), invite link 404/expired, switcher
missing.

---

## TEST 2: SSO + tampered-assertion rejection (punch list 14)

PREREQ: a dev IdP tenant (Okta, Azure AD, or Google Workspace dev). Free dev
tenants work. No env vars needed: SSO config is per-org in the DB.
STEPS (SAML or OIDC, pick one):
1. As admin, open `/admin/buyer-orgs/[id]/sso` for your test org (or the org admin
   opens `/buyer-org/sso`). Copy the SP metadata URL / Entity ID / ACS URL (SAML)
   or the Redirect URI (OIDC) into the IdP.
2. Paste back the IdP's Entity ID + SSO URL + signing cert (SAML) or Issuer +
   Client ID + Client secret (OIDC). Set the domain allowlist to your test email
   domain. Save.
   - NOTE: the allowlist now requires the domain to be DNS-VERIFIED first (the
     QA fix). If Save rejects an unverified domain, verify it under the org's
     Email domains card first (add the TXT record), then retry.
3. Visit `/api/auth/sso/initiate?email=<you@allowed-domain>` and complete the IdP
   login. Confirm you land logged in.
4. SECURITY CHECK: replay a tampered or expired assertion to the ACS endpoint
   (e.g. flip a byte in the SAMLResponse, or reuse an old one). Confirm it is
   REJECTED with no session created.

PASS: clean SSO login round-trips; a tampered/expired assertion creates NO session
(check there is no logged-in state, and the SsoLoginEvent shows FAILED_SIG /
FAILED_NOTAFTER). Only flip "Enforce SSO" AFTER a successful test login (it disables
password login for that domain; platform admin keeps break-glass).

---

## TEST 3: Approval workflow (punch list 15)

PREREQ: Stripe test keys set (STRIPE_SECRET_KEY + NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
+ STRIPE_WEBHOOK_SECRET in Vercel, test mode is fine), a buyer org with an approver.
STEPS:
1. As org admin, `/buyer-org/approval-rules`: create a rule "orders over $5,000
   need an Approver". Assign an APPROVER member (NOT yourself, the self-approval
   gate now blocks approving your own order).
2. As a BUYER member, place an order over $5,000. Confirm it PAUSES for approval
   (you see the awaiting-approval banner; it does NOT go to payment).
3. As the approver, approve it via the email link. NOTE: clicking the email link
   now lands on a confirmation page with an Approve button (the QA fix made GET
   non-actionable so mail scanners can't auto-approve). Click Approve.
4. Confirm payment can now proceed.
5. CONTROL: place a normal order as a NON-org buyer (or an org with no rule).
   Confirm it is NOT paused (approval only applies where a rule matches).
6. NEGATIVE CHECK: confirm a VIEWER member cannot approve (the role gate now
   blocks non-approver roles even via the email link).

PASS: big order pauses; approver approves via the confirm page; payment resumes;
non-org/no-rule checkout unaffected; VIEWER cannot approve.

---

## TEST 4: Net-terms invoice + dunning + auto-suspend (punch list 16)

PREREQ: Stripe test keys AND the Stripe webhook endpoint must subscribe to
`invoice.paid`, `invoice.payment_failed`, `invoice.marked_uncollectible` (in
addition to the existing checkout/refund/transfer events). Stripe Tax registrations
should cover the buyer's ship-to state (else tax computes $0, which is Stripe's
documented behavior, same as PREPAID).
STEPS:
1. As admin, `/admin/buyer-orgs/[id]/terms`: flip the org to NET_30 with a credit
   limit.
2. As an org buyer, place an order. Confirm NO Stripe Checkout (it is an invoice
   order); a Stripe ACH invoice is created and emailed.
3. Open the emailed hosted invoice link, confirm the ACH pay page works AND that
   sales tax is now shown (the net-terms tax fix). Confirm the on-platform invoice
   page + the A/R dashboard (`/admin/accounts-receivable`) show the same total
   incl. tax.
4. DUNNING: set `AR_SUSPEND_DAYS_PAST_DUE` low (or let an invoice pass its due
   date) and run `/api/cron/ar-dunning` (with the CRON_SECRET auth). Confirm the
   T+30 dunning email sends once and the org flips SUSPENDED. Confirm a suspended
   org's member gets a 423 at checkout.
5. Pay the past-due invoice (hosted ACH page). Confirm the org auto-reactivates
   and admins get the reactivated email.
6. CONTROL: confirm a PREPAID order still pays the supplier on dispatch and is
   unaffected by all of the above.

PASS: invoice arrives with correct tax; hosted ACH pay works; dunning fires once at
T+30; org suspends then auto-reactivates on payment; PREPAID unchanged.

---

## TEST 5: iPhone Safari (punch list 17)

WHY: mobile Safari renders differently from desktop Chrome; catches viewport,
touch, keyboard, scroll, modal, image, and font issues emulation misses.
STEPS (on a real iPhone, not the simulator):
1. Open the live preview URL in Safari.
2. Walk the main buyer flow: search/browse catalog -> open a product -> add to cart
   -> checkout -> place a demo order (demo mode lets a guest complete it now, the
   QA fix restored guest demo-pay).
3. Check: header/nav usable, product carousel swipes, filters/modal open and close,
   forms keyboard-friendly, images load, no horizontal overflow.

PASS: the full buyer path completes on a real iPhone with no broken layout or stuck
modal.

---

## BONUS sanity check: demo-pay is inert in production

Once Stripe LIVE keys are flipped, confirm `POST /api/orders/<id>/pay` returns 503
(the demo path must never settle money when a real provider is live). This is
enforced in code (the 503-when-payments-configured gate) and covered by unit tests,
but worth a one-time live confirmation after the live-key flip.

---

## After the tests pass

Then the cutover sequence (all owner-side, tracked in REMINDERS.md):
1. Entity -> bank -> Stripe LIVE keys in Vercel.
2. Sentry DSN (so production errors page you).
3. Demo-data wipe (say "go" and the wipe SQL runs: deletes @partsport.example seed
   accounts + their orders/quotes/messages, schema intact).
4. Attorney glance at the 5 legal pages + DPA/security/subprocessor pages.
5. First real supplier (THRADD/UltraTech) + first real buyer.
