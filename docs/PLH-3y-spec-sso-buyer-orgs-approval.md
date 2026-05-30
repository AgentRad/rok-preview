# PLH-3y: SSO, Multi-User Buyer Orgs, and Approval Workflows

Build-ready spec covering three sequential enterprise features. The three depend on each other in this exact order:

1. Multi-user buyer orgs (foundational schema for the other two)
2. SSO / SAML (per-org IdP, requires BuyerOrg to attach config to)
3. Approval workflows (requires BuyerOrgMember + roles to route from)

Pattern reference: `SupplierMember` + `SupplierInvite` + `SupplierTeam.tsx` + `/api/supplier/team`. Mirror that shape end to end. `BuyerOrg` is to a buyer what `Supplier` is to a supplier company.

Author note on order: the prompt lists SSO first because that is the loudest enterprise word. The actual build order MUST be Orgs first. SSO without an org to attach to has no domain locking, no group-to-role mapping target, and no SCIM destination. See section 5 round breakdown.

---

## 1. SSO / SAML

### Protocols

Ship SAML 2.0 first, OIDC second. SAML is what Okta, Azure AD, Ping, OneLogin, and ADFS all speak as their default. OIDC is the modern default for Google Workspace, Auth0, and newer IdPs and is materially simpler (JSON, JWT, no XML signature canonicalization hell). Both behind the same `SsoConfig` row with a discriminator.

### Library recommendation: `@node-saml/node-saml` + `openid-client`

Use `@node-saml/node-saml` (the maintained fork of passport-saml, no Passport dependency required) for SAML and `openid-client` for OIDC. Wire both as plain Next.js Route Handlers, not as NextAuth providers.

Pros:
- Direct control of the login flow. We already roll our own JWT session cookie in `src/lib/auth.ts`. NextAuth would force a parallel session system or a heavy refactor of every existing auth gate.
- `@node-saml/node-saml` handles AssertionConsumerService, signature verification, NotBefore/NotOnOrAfter clock skew, and audience restriction without pulling in Passport middleware.
- `openid-client` is the official Auth0-maintained client and handles PKCE, discovery, JWKS rotation, and refresh tokens correctly.
- Per-tenant config (one cert per buyer org) is awkward in NextAuth providers, native in node-saml.

Cons:
- Two libraries instead of one. SAML XML parsing pulls in `xml-crypto` + `xml2js`. Roughly +400 KB to the server bundle for the SSO routes only (does not affect buyer / supplier pages, those routes are not on the same Edge function).
- We own metadata refresh, cert rotation alerts, and SLO ourselves.

Alternatives considered and rejected:
- `next-auth` SAML provider: forces a parallel session model. Painful migration. Per-tenant cert config requires custom storage adapter.
- Custom SAML from scratch: signature verification is a security trap (XML signature wrapping attacks, comment-in-NameID injection). Use the library.
- WorkOS / Auth0 / Stytch hosted: $0.10 to $3.00 per MAU adds up fast at scale and we lose direct session control. Backlog as a fallback if maintenance burden becomes real, but not for v1.

### Schema

```prisma
enum SsoIdpType {
  SAML
  OIDC
}

model SsoConfig {
  id              String     @id @default(cuid())
  buyerOrgId      String     @unique
  buyerOrg        BuyerOrg   @relation(fields: [buyerOrgId], references: [id], onDelete: Cascade)
  idpType         SsoIdpType
  // SAML fields
  idpEntityId     String?    // <EntityID> from IdP metadata
  idpSsoUrl       String?    // SingleSignOnService Location
  idpSloUrl       String?    // SingleLogoutService Location (optional)
  idpX509Cert     String?    @db.Text  // PEM, signing cert
  idpX509CertNext String?    @db.Text  // staged for rotation
  // OIDC fields
  oidcIssuer      String?
  oidcClientId    String?
  oidcClientSecret String?   @db.Text
  // Common
  domainAllowlist String[]   // ["procter.com", "pg.com"]
  // SCIM
  scimEnabled     Boolean    @default(false)
  scimTokenHash   String?    @unique  // SHA-256 hex, raw shown once
  scimTokenLast4  String?    // for UI display
  // Mapping
  groupRoleMap    Json?      // { "PartsPort-Admins": "ADMIN", "Procurement": "BUYER" }
  defaultRole     BuyerOrgRole @default(BUYER)
  // Policy
  enforced        Boolean    @default(false)  // when true, password login disabled for matched domains
  sessionMaxAgeMin Int       @default(480)    // 8 hours, IdP override below
  honorIdpSessionExpiry Boolean @default(true)
  // Audit
  configuredById  String
  configuredAt    DateTime   @default(now())
  rotatedCertAt   DateTime?

  @@index([buyerOrgId])
}

model SsoLoginEvent {
  id          String   @id @default(cuid())
  buyerOrgId  String
  userId      String?
  email       String
  outcome     String   // SUCCESS | FAILED_SIG | FAILED_NOTAFTER | FAILED_DOMAIN | FAILED_AUDIENCE
  ipHash      String
  userAgent   String
  createdAt   DateTime @default(now())

  @@index([buyerOrgId, createdAt])
  @@index([email, createdAt])
}
```

`User.email` already unique, so domain locking is enforced by matching the lowercased domain part against `SsoConfig.domainAllowlist` at login time and rejecting password login when `enforced=true` and the user is in a locked domain.

### Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/sso/initiate` | GET | Accepts `?email=` or `?orgId=`. Resolves SsoConfig, redirects to IdP (SAML AuthnRequest or OIDC `/authorize`). |
| `/api/auth/sso/saml/[orgId]/acs` | POST | Assertion Consumer Service. Verifies signature, NotBefore/NotOnOrAfter, audience. JIT-provisions on first login. |
| `/api/auth/sso/oidc/[orgId]/callback` | GET | OIDC code exchange + JWKS verify. |
| `/api/auth/sso/saml/[orgId]/metadata` | GET | Serve our SP metadata XML so the IdP admin can configure us in one paste. |
| `/api/auth/sso/slo/[orgId]` | POST | Single logout. Verifies and destroys session. Best-effort: also redirects to IdP SLO when configured. |
| `/api/scim/v2/[orgId]/Users` | GET/POST/PATCH/DELETE | SCIM 2.0 user CRUD. Bearer token = `SsoConfig.scimTokenHash` match. |
| `/api/scim/v2/[orgId]/Groups` | GET only in v1 | Read-only group list, mostly for IdP debugging. |
| `/api/scim/v2/[orgId]/ServiceProviderConfig` | GET | Standard SCIM discovery doc. |
| `/api/admin/orgs/[id]/sso` | GET/PUT/DELETE | Admin UI backend for editing SsoConfig and rotating cert. |
| `/api/admin/orgs/[id]/sso/test` | POST | Dry-run an AuthnRequest against the IdP, return parsed assertion without creating a session. |

### JIT provisioning

On first SSO login from an unknown email at a domain in `SsoConfig.domainAllowlist`:
1. Create `User` row with `role=BUYER`, `passwordHash=""` (empty string blocks password login; existing `verifyPassword` already returns false), `emailVerified=now()` (IdP attests).
2. Create `BuyerOrgMember` with role from `groupRoleMap[group]` if any matched group in the assertion, else `SsoConfig.defaultRole`.
3. Set `companyName` from `BuyerOrg.name` if blank.
4. Write `SSO_PROVISIONED` audit.

On subsequent login: update `BuyerOrgMember.role` from group map (so IdP group changes propagate on next login), bump `User.sessionsValidFrom` is NOT called (would invalidate concurrent tabs).

### Group-to-role mapping

`SsoConfig.groupRoleMap` is `{ idpGroupName: BuyerOrgRole }`. Multi-group user: highest-privilege role wins (`ADMIN > APPROVER > BUYER > VIEWER`). Unmapped groups ignored. No matched group: `defaultRole`. Empty map: every JIT user gets `defaultRole`.

For SAML, group attribute name defaults to `http://schemas.xmlsoap.org/claims/Group` and `memberOf`, with override field `groupAttributeName` on SsoConfig (omitted from the schema block above for brevity; add it).

### Domain locking

When a user attempts password login at `/api/auth/login`, look up `SsoConfig` where `email.domain` is in `domainAllowlist` AND `enforced=true`. If matched, return 403 with `{ error: "Sign in with SSO", ssoInitiateUrl: "/api/auth/sso/initiate?email=..." }`. The login page intercepts that response and redirects.

### Emergency password access

Always-on backdoor for admin recovery: any `User` with `role=ADMIN` (platform admin, not BuyerOrgRole.ADMIN) bypasses domain locking. Documented as the break-glass path. Audit `EMERGENCY_PASSWORD_LOGIN` whenever a domain-locked email logs in via password (which is only possible for platform admin role).

Per-org break-glass: `BuyerOrgMember` with `role=ADMIN` and `emergencyPasswordAccess=true` (boolean column on the membership) can password-login even when their domain is enforced. Off by default. Org admin can flip on a per-member basis at `/buyer-org/[id]/team`. Forces 2FA when toggled on.

### Session timeout behavior

Two-policy stack:
- PartsPort base: 30 days (existing).
- Org SSO override: `SsoConfig.sessionMaxAgeMin` (default 8h).

When a user provisioned through SSO logs in, the JWT `exp` claim is set to `min(30d, sessionMaxAgeMin)`. Also add `sso` and `org` claims to the JWT (`{ uid, svf, sso: true, org: "<orgId>" }`) so middleware can re-enforce.

When `honorIdpSessionExpiry=true` and OIDC returns a refresh token, store the refresh token hash and run a daily cron `/api/cron/sso-session-refresh` that calls IdP introspection; if the IdP says the user is gone, bump `User.sessionsValidFrom` to invalidate the cookie.

SAML has no introspection. Rely on session max age plus SCIM deprovision for SAML.

### SCIM provisioning

Scope for v1: users only. Group sync read-only (groups exist for the role mapping, but PartsPort does not let an IdP edit which roles exist).

User SCIM endpoints implement:
- `GET /Users?filter=userName eq "x@y.com"` (Okta uses this on every login)
- `POST /Users` create -> JIT-equivalent
- `PATCH /Users/{id}` `active: false` -> bump `sessionsValidFrom`, set `BuyerOrgMember` flag `deactivatedAt=now()`, write `SSO_DEPROVISIONED`
- `DELETE /Users/{id}` -> same as deactivate, do NOT hard-delete (order history references)
- `PUT /Users/{id}` full replace -> update name, email (with the email-change audit pattern from PLH-1)

Bearer token check: `sha256(req.headers.authorization.slice(7))` compared timing-safe against `SsoConfig.scimTokenHash`. 401 on mismatch.

Rate limit: `rateLimit("scim", org:<orgId>)` at 600/min/org (Okta bursts hard on initial sync).

### Audit events

`SSO_INITIATED`, `SSO_LOGIN_SUCCESS`, `SSO_LOGIN_FAILED` (with reason), `SSO_PROVISIONED`, `SSO_DEPROVISIONED`, `SSO_CONFIG_UPDATED`, `SSO_CERT_ROTATED`, `SCIM_TOKEN_ROTATED`, `EMERGENCY_PASSWORD_LOGIN`. All write to existing `AuditLog`. SsoLoginEvent is the high-volume log; AuditLog gets the management-plane events.

### Pricing

Industry standard SSO tax is real. Okta itself charges roughly $2/user/mo on top of base. WorkOS bills the vendor (us) at $0.10 to $1.25 per connection per mo or $3-5/MAU.

Recommended PartsPort pricing:
- Free SSO on the Business plan ($X/mo, includes BuyerOrg up to 25 seats). This is the "no SSO tax" stance, which is increasingly the table-stakes posture and converts better.
- Enterprise plan unlocks SCIM, group-to-role mapping, domain enforcement, audit log export. Custom pricing.
- For the actual numbers see section 4 decisions; we are not setting list price in this doc.

Recommendation: free SSO (no tax). Procurement teams at utilities will pattern-match SSO tax as anti-buyer and we are the small player in a relationship-driven sale. SCIM and the enterprise control plane are where the price differentiation belongs.

### Build estimate

10 to 14 working days for one engineer.
- 2d: SsoConfig schema + admin CRUD + metadata endpoint
- 3d: SAML ACS + signature verification + JIT
- 2d: OIDC callback + JIT
- 2d: SCIM endpoints
- 1d: domain locking + login UI surfaces
- 1d: SLO + session timeout enforcement
- 2d: testing matrix (Okta, Azure AD, Google Workspace fixtures) + cert rotation flow
- 1d: docs for IdP admins (Okta setup guide, Azure setup guide)

---

## 2. Multi-User Buyer Orgs

Foundational. Ship before SSO and before approvals.

### Schema

```prisma
enum BuyerOrgRole {
  ADMIN      // manage members, billing, SSO config, approval rules
  APPROVER   // approve / reject orders routed to them
  BUYER      // place orders, may require approval
  VIEWER     // read-only across all org orders
}

model BuyerOrg {
  id                String             @id @default(cuid())
  name              String
  legalName         String?
  logoUrl           String?
  // Domain auto-join: users registering with @company.com get auto-added
  // as defaultRole. Set carefully (see section 4).
  autoJoinDomains   String[]           @default([])
  autoJoinRole      BuyerOrgRole       @default(VIEWER)
  // Centralized billing
  defaultPaymentMethodId String?       // Stripe PaymentMethod, org-owned card
  billingMode       String             @default("MEMBER") // MEMBER | ORG | HYBRID
  // Org-level shared resources
  defaultShipToAddressId String?       // FK to Address (owned by an "org system user" or admin)
  taxExemptCertificateUrl String?
  taxExemptStatus   String?
  taxExemptExpiresAt DateTime?
  // 2FA enforcement
  require2FA        Boolean            @default(false)
  createdById       String
  createdAt         DateTime           @default(now())
  members           BuyerOrgMember[]
  invites           BuyerOrgInvite[]
  ssoConfig         SsoConfig?
  approvalRules     ApprovalRule[]
  orders            Order[]            @relation("OrdersByBuyerOrg")

  @@index([createdById])
}

model BuyerOrgMember {
  id                String       @id @default(cuid())
  buyerOrgId        String
  buyerOrg          BuyerOrg     @relation(fields: [buyerOrgId], references: [id], onDelete: Cascade)
  userId            String
  user              User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  role              BuyerOrgRole @default(BUYER)
  // Per-member spending guardrails (independent of approval rules)
  spendCapCents     Int?         // null = no cap
  spendCapWindow    String?      // DAY | WEEK | MONTH
  // Centralized billing: when true and org billingMode is MEMBER, this
  // member is allowed to charge the org card.
  canUseOrgPaymentMethod Boolean @default(false)
  // Emergency password access when SSO domain enforcement is on.
  // See SSO section.
  emergencyPasswordAccess Boolean @default(false)
  // Out-of-office delegation for APPROVER role.
  delegateToMemberId String?
  oooUntil          DateTime?
  // Soft-deactivate (set by SCIM or admin). Keeps order ownership intact.
  deactivatedAt     DateTime?
  createdAt         DateTime     @default(now())

  @@unique([buyerOrgId, userId])
  @@index([userId])
  @@index([buyerOrgId, role])
}

model BuyerOrgInvite {
  id          String       @id @default(cuid())
  buyerOrgId  String
  buyerOrg    BuyerOrg     @relation(fields: [buyerOrgId], references: [id], onDelete: Cascade)
  email       String
  role        BuyerOrgRole @default(BUYER)
  tokenHash   String       @unique
  invitedById String
  expiresAt   DateTime
  acceptedAt  DateTime?
  createdAt   DateTime     @default(now())

  @@index([buyerOrgId])
  @@index([email])
}
```

User changes:
- `User.activeBuyerOrgId String?` to support a user belonging to multiple orgs. Switcher in nav writes this. Defaults to first membership.

Order changes:
- `Order.buyerOrgId String?` (nullable: guest checkout and individual buyers remain orgless). Snapshotted at order creation.
- `Order.placedByMemberId String?` (the human who placed it, for spend visibility filtering).
- `Order.approvalStatus String @default("NONE")` and `Order.approvedByMemberId String?` (see section 3).

### Invite flow

Mirror `SupplierInvite` exactly:
1. Org admin POSTs `/api/buyer-org/[id]/team` with `{ email, role }`.
2. Server generates 32-byte token, stores `sha256(token)` as `tokenHash`, sends `sendBuyerOrgInvite` email with `/buyer-org/invite/[token]` link, 14-day expiry.
3. Invited user clicks link. If signed in: insert `BuyerOrgMember`, delete invite, set `User.activeBuyerOrgId`. If signed out: route to register/login with token preserved in query, accept after auth.
4. Email matched: insert membership. Email NOT matched (signed-in user clicks invite for a different email): show "This invite was sent to X. Sign out and use that email."

### Domain auto-join

`BuyerOrg.autoJoinDomains` + `autoJoinRole`. At register-time and at first SSO JIT, after creating the User, query for any BuyerOrg whose `autoJoinDomains` contains the email's domain. If exactly one matches: auto-add as `autoJoinRole`. If multiple match (rare, only via misconfiguration): do not auto-join, surface to platform admin via attention card.

Risk: a malicious org admin claims a popular domain (`gmail.com`) and auto-onboards everyone. Mitigation: domain must be DNS-verified before it can be added to `autoJoinDomains`. Verification flow: add domain in PENDING, surface TXT record `partsport-verify=<token>`, cron `/api/cron/buyer-org-domain-verify` daily, flips to VERIFIED. Free-email domains (gmail, outlook, yahoo, icloud, hotmail, aol, proton) on a hard blocklist, return 400 if added. Default `autoJoinRole=VIEWER` so even a successful misclaim limits damage.

### Role permission matrix

| Capability | ADMIN | APPROVER | BUYER | VIEWER |
|---|---|---|---|---|
| Invite / remove members | Y | N | N | N |
| Change member role | Y | N | N | N |
| Edit org profile, logo, address book | Y | N | N | N |
| Edit SSO config | Y | N | N | N |
| Edit approval rules | Y | N | N | N |
| Manage org payment method | Y | N | N | N |
| Place order | Y | Y | Y | N |
| Use org payment method | Y (always) | If flag | If flag | N |
| Approve / reject pending orders | Y | Y (those routed to them) | N | N |
| View all org orders | Y | Approver: those they routed | Buyer: own only | All (read) |
| Open returns | Y | Own only | Own only | N |
| Export CSV of org orders | Y | N | N | Y |

`Order.canViewedByMember(member)` helper centralizes the spend-visibility rule.

### Centralized billing

Three modes on `BuyerOrg.billingMode`:
- `MEMBER` (default): every member checks out with their own card. Org has no Stripe customer.
- `ORG`: every order charges the org-saved PaymentMethod. Member cards hidden at checkout. Requires `BuyerOrgMember.canUseOrgPaymentMethod` to charge.
- `HYBRID`: member picks per-order. Org card surfaces when `canUseOrgPaymentMethod=true`.

Implementation: org gets its own Stripe Customer when billingMode flips off MEMBER. PaymentMethod attached to that customer. Checkout flow checks org mode, switches Stripe Customer to the org customer when charging org card, passes through metadata `{ orgId, placedByMemberId }`.

Recommendation: ship HYBRID as default for v1. Conrad can flip to MEMBER-only for orgs that ask. ORG-only is an enterprise control plane feature and can wait.

### Org-level shared resources

- Address book: an "org system address" model option is overkill. Simpler: `BuyerOrg.defaultShipToAddressId` points at an Address row owned by the org's first ADMIN, with a flag `Address.sharedWithOrgId String?` on Address. Members see shared addresses in their dropdown. Edits require ADMIN role.
- Tax-exempt cert: lifted from per-Address to org-level (`BuyerOrg.taxExemptCertificateUrl`). `lookupTaxExemption` updated to check the org cert first when `Order.buyerOrgId` is set.
- Default ship-to: when a member checks out, `BuyerOrg.defaultShipToAddressId` is pre-selected. Member can override per-order.

### Member removal: order ownership

When a member is removed (DELETE `/api/buyer-org/[id]/team/[memberId]`):
1. Block deletion if any Order for this member is in PENDING_APPROVAL with this member as the approver. Force admin to reassign or override approval first. 409 with `{ error: "Reassign N pending approvals first." }`.
2. Else: soft-deactivate (`deactivatedAt=now()`) rather than hard delete. User row stays. `BuyerOrgMember` row stays so historical `Order.placedByMemberId` still resolves.
3. Bump `User.sessionsValidFrom` only if this was the user's only active org (else they keep their session for other orgs).
4. Audit `BUYER_ORG_MEMBER_REMOVED`.

Hard delete only available to platform ADMIN, with a forced reassignment of `Order.placedByMemberId` to the org admin first.

### Cross-org membership

A user can be a member of N orgs. `User.activeBuyerOrgId` selects the active context. Org switcher in the top nav (compact dropdown when memberships > 1, hidden when = 1). All "org-scoped" queries filter on `activeBuyerOrgId`. POST `/api/buyer-org/switch` writes the field.

When a checkout happens, the active org at checkout time is snapshotted onto `Order.buyerOrgId`. Switching orgs after checkout does not retroactively rewrite past orders.

### Spend visibility

Centralized in `canViewOrder(member, order)`:
- ADMIN: every order in their org.
- APPROVER: orders they approved/rejected + orders currently routed to them (PENDING_APPROVAL where they are the assigned approver).
- BUYER: own orders only (where `placedByMemberId === memberId`).
- VIEWER: every order in their org.

`/account/orders` page filters via this rule when `activeBuyerOrgId` is set.

### Migration order vs SSO

Buyer orgs MUST ship before SSO. SSO needs `BuyerOrg` to attach `SsoConfig` to, needs `BuyerOrgMember` as the JIT provisioning target, needs `BuyerOrgRole` for group mapping. The reverse is not true: orgs work fine without SSO (password auth, manual invites).

### Build estimate

8 to 10 working days.
- 1d: schema + migration + indexes
- 2d: org CRUD + admin UI at `/buyer-org/[id]`
- 2d: team management (invite/accept/remove/role), copy `SupplierTeam.tsx`
- 1d: org switcher in nav + `activeBuyerOrgId` plumbing
- 1d: domain auto-join + DNS verification flow
- 1d: org-level address book + tax-exempt cert lift
- 1d: centralized billing wiring (HYBRID mode)
- 1d: spend visibility + order filtering + tests

---

## 3. Approval Workflows

Depends on BuyerOrgMember + BuyerOrgRole from section 2.

### Order state machine

Extend existing `OrderStatus`:

```
DRAFT_PENDING_APPROVAL  -> APPROVED -> PENDING -> PAID -> FULFILLED
                       \-> REJECTED (terminal)
                       \-> AUTO_APPROVED -> PENDING -> PAID -> ...
                       \-> EMERGENCY_BYPASSED -> PENDING -> PAID -> ...
```

Implementation: add `Order.approvalStatus` column (`NONE | PENDING | APPROVED | AUTO_APPROVED | REJECTED | BYPASSED`) instead of widening `OrderStatus`. `OrderStatus` stays for the payment / fulfillment lifecycle. The two compose: an `Order` with `approvalStatus=PENDING` cannot transition `status` to `PAID` (server-enforced in the Stripe Checkout creation route).

Workflow:
1. Buyer hits checkout. Approval engine evaluates rules. If any rule matches: Order created with `status=PENDING`, `approvalStatus=PENDING`, no Stripe Checkout session, redirect to "Order submitted for approval" page.
2. Email sent to assigned approver(s). In-app notification.
3. Approver hits approve. `approvalStatus=APPROVED`. Engine then creates the Stripe Checkout session and emails the buyer "Approved, complete payment." Buyer's email contains the Stripe Checkout URL (signed token; same pattern as PLH-3c F0).
4. Approver rejects. `approvalStatus=REJECTED, status=CANCELLED`. Buyer notified with reason.

### ApprovalRule model

```prisma
model ApprovalRule {
  id                String       @id @default(cuid())
  buyerOrgId        String
  buyerOrg          BuyerOrg     @relation(fields: [buyerOrgId], references: [id], onDelete: Cascade)
  name              String
  // Filter conditions. ALL must match for the rule to apply.
  minTotalCents     Int?         // null = no min
  maxTotalCents     Int?         // null = no max
  category          String?      // matches Product.category on any item
  supplierId        String?
  placedByMemberId  String?      // route only when this member places
  // Action
  approverMemberId  String?      // specific approver
  approverRole      BuyerOrgRole? // any member with this role (typically APPROVER)
  // Chaining: rules with the same chainGroup execute in `chainOrder` order
  chainGroup        String?
  chainOrder        Int          @default(0)
  // Auto-escalate
  escalateAfterHours Int?
  escalateToMemberId String?
  // Auto-approval pattern matching
  autoApproveIfHistoricalMatch Boolean @default(false)
  // Active toggle
  enabled           Boolean      @default(true)
  createdAt         DateTime     @default(now())

  @@index([buyerOrgId, enabled])
}

model OrderApproval {
  id                String   @id @default(cuid())
  orderId           String
  order             Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  ruleId            String?  // null when emergency bypass
  approverMemberId  String?  // null when AUTO or BYPASS
  outcome           String   // APPROVED | REJECTED | AUTO_APPROVED | ESCALATED | BYPASSED
  reason            String   @default("")
  decidedAt         DateTime @default(now())

  @@index([orderId])
}
```

### Rule evaluation

`evaluateApprovalRules(order, member, orgRules)` in `src/lib/approval.ts`:
1. Filter rules to those that match the order (threshold, category, supplier, placer).
2. If none match: `approvalStatus=AUTO_APPROVED`. Insert OrderApproval row outcome=AUTO_APPROVED.
3. If one or more match, group by `chainGroup`. First chain step is the active approver; on approval, advance to the next chain step. Order is APPROVED only when all chain steps complete.
4. If `autoApproveIfHistoricalMatch=true` and the order matches the historical pattern (same supplier, same productId set, within 25% of total of an approved order in last 90d from the same member): auto-approve with `outcome=AUTO_APPROVED`.

Multi-level: a chainGroup with rules at chainOrder 0, 1, 2 routes sequentially. ADMIN approval at any step short-circuits remaining steps when ADMIN is in the chain.

Department/category routing: `ApprovalRule.category` filter is the cheapest path. For real department routing, add `BuyerOrgMember.department String?` and `ApprovalRule.requireDepartment String?` later. v1 ships with category and supplier filters only.

### One-click email approve

Approver email includes two buttons: Approve and Reject. Each is a signed URL: `/api/approval/decide?token=<hmac>`. Token signs `{ orderId, decision, approverMemberId, expiresAt }` with `APPROVAL_LINK_SECRET` (falls back to `SESSION_SECRET`). 7-day expiry. Single-use enforced by checking `OrderApproval.decidedAt IS NULL` for this approver before recording. Reject token goes to `/approval/reject/[token]` page that requires a 1-line reason before submitting.

Approver must still be a member with the right role at decision time (re-checked server-side). No login required for the click-through itself, but the page shows a "Confirm decision as X" with the email surfaced.

### Auto-escalate

Cron `/api/cron/approval-escalate` every 30 minutes. For each `OrderApproval` PENDING for longer than `rule.escalateAfterHours`:
1. Insert `OrderApproval` row `outcome=ESCALATED, approverMemberId=<original>`.
2. Reassign to `rule.escalateToMemberId` or to org ADMINs if not set.
3. Email new approver + original approver.

### Approver delegation (OOO)

`BuyerOrgMember.delegateToMemberId` + `oooUntil` (already in section 2 schema). When evaluating rules, if `member.oooUntil > now`, route to `member.delegateToMemberId` instead. The original approver still appears in the audit trail.

### Bulk approval

`/buyer-org/[id]/approvals` page shows pending list with checkboxes. ADMIN can multi-select and approve up to 50 at once. `POST /api/buyer-org/[id]/approvals/bulk` with array of order ids. Reason field required.

### Emergency bypass

ADMIN-only button on the approval-pending order page: "Bypass approval (admin)". Requires a 1-line reason, 2FA re-prompt. Sets `approvalStatus=BYPASSED`, creates Stripe Checkout immediately. `EMERGENCY_APPROVAL_BYPASS` audit with reason.

### SLA reporting

Admin dashboard tile (`/buyer-org/[id]/dashboard`):
- Median approval time last 30d
- Approvals over SLA last 30d (default SLA: 24h)
- Pending approvals over 24h
- Approval rate by approver

Single SQL query backing each. Computed at request time; caching deferred.

### Approver leaves org

Daily cron `/api/cron/approval-orphan-sweep`:
1. Find OrderApproval rows where `approverMemberId.deactivatedAt IS NOT NULL` and decidedAt IS NULL.
2. Reassign to a same-role member; if none, escalate to org ADMINs.
3. Email new approver. Audit `APPROVAL_ORPHANED_REASSIGNED`.

When an admin removes a member with pending approvals, the section 2 removal flow already blocks until reassigned. The cron catches the SCIM/SSO-deprovisioned path that bypasses the UI.

### UI

- `/buyer-org/[id]/approvals` — pending list (approver/admin view).
- `/buyer-org/[id]/approvals/history` — decided list.
- `/orders/[id]` — when `approvalStatus !== NONE`, show approval timeline card (who, when, outcome, reason). Also surfaces the chain steps with pending/approved/rejected per step.
- Pending banner on the buyer's order page when their order is awaiting approval, with the assigned approver name and "Last poked X hours ago" + a poke-approver button (rate-limited).

### Notifications

Email + in-app:
- `sendApprovalRequested(approver, order)` on rule match
- `sendApprovalApproved(buyer, order)` on approve
- `sendApprovalRejected(buyer, order, reason)` on reject
- `sendApprovalEscalated(newApprover, originalApprover, order)` on auto-escalate
- `sendApprovalBypassed(admins, order, reason)` on emergency bypass

All gated on PLH-2 4d `notifyOrderEmails` (approval is order-context, so use that bucket).

### Build estimate

8 to 11 working days.
- 1d: schema + migration
- 2d: rule evaluation engine + tests (heavy on test cases)
- 2d: approval pages + buyer banner + order timeline
- 1d: one-click email approve flow with signed tokens
- 1d: auto-escalate cron + delegation
- 1d: bulk approval + emergency bypass
- 1d: SLA dashboard tile
- 1d: notification fan-out + audit

---

## 4. Cross-cutting decisions needed from Conrad

Decide before building. Recommendation first, alternative second.

| # | Decision | Recommendation | Alternative |
|---|---|---|---|
| 1 | IdP priority for v1 | Ship SAML generic + tested against Okta + Azure AD. Google Workspace OIDC in v1.1. | Add Google Workspace OIDC to v1 (low marginal cost since OIDC ships anyway, +1d for the GWS-specific gotchas). |
| 2 | SSO pricing | Free SSO at Business tier (no tax). SCIM + audit export = Enterprise tier. | Charge $X/seat for SSO ($1-3/mo industry range). Risk: pattern-matches as anti-buyer in a relationship-driven utility sale. |
| 3 | Domain auto-join risk | Default `autoJoinRole=VIEWER`, require DNS TXT verification, hard-block free-email domains. Admin must manually promote auto-joined members. | Default `autoJoinRole=BUYER`. Simpler onboarding, real risk of misconfig blast radius. |
| 4 | Default approval thresholds for new orgs | One default rule on org creation: orders > $5,000 require an ADMIN approver. Org admin tunes from there. | Ship with zero default rules. Forces every new org to set this up before first PO over threshold, but cleaner. |
| 5 | Default 2FA enforcement at org creation | OFF by default. Org admin opts in. | ON by default for orgs with SSO disabled. Friction at onboarding. |
| 6 | Org-level vs member-level payment | Ship HYBRID mode default. ORG-only and MEMBER-only as opt-in modes. | Ship MEMBER-only for v1 to defer the Stripe Customer dance. Punts the centralized-billing ask another round. |

---

## 5. Recommended round breakdown

Six rounds. Each independently shippable, 3-7 days of build, coherent user-facing increment. Order is load-bearing.

**PLH-3y-1: Buyer org foundation (4-5d).** BuyerOrg + BuyerOrgMember + BuyerOrgInvite schema. Admin-managed org creation at `/admin/buyer-orgs` (no self-serve yet). Invite flow ported from `SupplierTeam.tsx`. Org switcher in nav. `activeBuyerOrgId` plumbing. No SSO, no approvals. User-visible: existing buyers can be grouped under an org by Conrad, see their company in nav.

**PLH-3y-2: Org-level shared resources + billing modes (3-4d).** Shared address book, lifted tax-exempt cert, HYBRID billing mode with org Stripe Customer. Spend visibility filter on `/account/orders`. CSV export of org orders for ADMIN. User-visible: ADMINs see all org orders, members see their own, shared ship-to surfaces at checkout.

**PLH-3y-3: Domain auto-join + DNS verification (3-4d).** TXT verification cron, auto-join on register and on SSO JIT (forward-compatible), free-email blocklist, attention card for misconfig. User-visible: a new buyer signing up with @acme.com gets prompted "Join Acme Org as Viewer?" if Acme has the domain verified.

**PLH-3y-4: SSO SAML + JIT (6-7d).** SsoConfig schema, SAML ACS, metadata endpoint, JIT into BuyerOrgMember, domain locking with admin break-glass, group-to-role mapping, session timeout, SAML audit table, admin SSO config UI under `/admin/buyer-orgs/[id]/sso` + `/buyer-org/[id]/sso` for org ADMINs. User-visible: an org admin pastes IdP metadata, members sign in with Okta/Azure AD.

**PLH-3y-5: OIDC + SCIM + cert rotation (4-5d).** OIDC callback flow, SCIM 2.0 users (read, create, deactivate), SCIM bearer token issuance, cert rotation flow (staged + activate), SLO. User-visible: Google Workspace orgs can SSO, Okta SCIM auto-provisions and deprovisions.

**PLH-3y-6: Approval workflows (7-8d).** ApprovalRule + OrderApproval schema, evaluation engine, approver pages, one-click email approve, auto-escalate cron, OOO delegation, bulk approval, emergency bypass, SLA dashboard tile, orphan sweep cron. User-visible: org admin sets "orders over $5K need ADMIN approval", buyer's checkout becomes a draft, approver clicks approve in email, buyer pays.

Total: roughly 27-33 build days, 6 deployable rounds. Each round is a coherent user-facing improvement and reversible if backed out before the next round starts. Save SSO for after the org foundation lands so we never have to migrate SsoConfig FK targets mid-build.
