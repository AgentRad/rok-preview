# PartsPort Security Questionnaire Response

Reference answers for vendor security questionnaires (SIG, CAIQ, HECVAT, ad-hoc). Copy individual answers into the buyer's form. Each answer reflects PartsPort's actual setup as of 2026-05-27. Do not overstate.

When in doubt, point the requester at:
- Security posture: https://partsport.agentgaming.gg/legal/security
- DPA: https://partsport.agentgaming.gg/legal/dpa
- Subprocessors: https://partsport.agentgaming.gg/legal/subprocessors

Compliance status to state plainly: PartsPort is working toward SOC 2 Type II readiness. We do not currently hold a SOC 2 attestation or an ISO 27001 certificate. We have not engaged a third-party auditor.

---

## A. Data classification and inventory

**1. What categories of customer data does PartsPort store?**
Business identifiers (name, work email, company, phone), shipping addresses, order and RFQ content, freight tracking, invoice and payout metadata, payment metadata (last4 and Stripe token references only; no full PAN), session and authentication metadata, and security and audit logs.

**2. Do you store cardholder data or full bank account numbers?**
No. Payment card data and ACH account numbers are tokenized by Stripe. PartsPort stores only the last4, brand, and Stripe token reference.

**3. Where is customer data located?**
All customer data is processed in the United States. Application: Vercel US-East. Database: Neon Postgres US-East. Blob storage: Vercel Blob. We do not transfer customer Personal Data outside the United States in the ordinary course of operation.

## B. Access controls

**4. How is access to production systems controlled?**
Production access uses least-privilege role assignments on Vercel, Neon, Stripe, Resend, and other provider consoles. Multi-factor authentication is required on every administrative provider console.

**5. How are end-user accounts authenticated?**
Email and password with bcrypt-hashed credentials. Optional TOTP-based two-factor authentication is available to every user. Minimum password length is 8 characters.

**6. Do you support SSO / SAML / SCIM?**
Not at this time. SSO is on the post-launch roadmap.

**7. How are sessions managed?**
Signed JWT session cookies. Credential-changing events (password reset, password change, 2FA disable, email change confirmation, account self-delete) bump a server-side sessionsValidFrom timestamp that invalidates every existing session for the user.

**8. Is there an audit log of administrative actions?**
Yes. An append-only audit log captures administrative and sensitive supplier-side actions with actor, action, target, and metadata. Reviewable at /admin/audit. Audit log entries are retained for 90 days.

## C. Encryption

**9. Is data encrypted in transit?**
Yes. TLS 1.3 between clients and PartsPort, and between PartsPort and its providers. HTTP is redirected to HTTPS.

**10. Is data encrypted at rest?**
Yes. AES-256 at rest via Neon for the database and Vercel Blob for file storage. Database backups are encrypted by the provider.

**11. How are application secrets managed?**
Secrets live in Vercel environment variables, scoped per environment. They are not committed to source control. Provider API keys are rotated on staff change.

## D. Business continuity and disaster recovery

**12. Do you have a documented BCP/DR plan?**
PartsPort relies on its managed providers for high availability and backups. Neon provides automated point-in-time recovery. Vercel provides multi-region edge with US-East as the primary serverless region. A formal written BCP/DR runbook is in development and will be published with future compliance attestation.

**13. What is your RPO and RTO?**
Targets: RPO 24 hours, RTO 8 hours. Database backup cadence and provider SLAs support these targets in practice; we do not contractually warrant them at this time.

**14. How often are backups tested?**
Database restore was last exercised during the migration of the production tenant. A scheduled quarterly restore drill is being added.

## E. Incident response

**15. Do you have an incident response process?**
Yes. On detection of a security incident or Personal Data Breach, the response team isolates affected accounts where appropriate, investigates and contains the issue, and notifies affected customers without undue delay and in any event within 24 hours of confirmation. A post-incident written summary is provided on request.

**16. Have you experienced a Personal Data Breach in the last 12 months?**
No.

**17. How are customers notified?**
By email to the DPA contact on file, or to the account email when no DPA contact is on file.

## F. Vulnerability and patch management

**18. How are dependencies kept up to date?**
GitHub Dependabot tracks dependency advisories. Security-relevant advisories are triaged on receipt. Material framework upgrades flow through the standard branch + build-gated review process.

**19. Do you run automated security scans?**
Server-side errors and security-relevant exceptions are captured by Sentry. Static analysis is performed by TypeScript and ESLint on every build. A dedicated SAST/DAST tooling rollout is on the post-launch roadmap.

**20. Do you have a responsible disclosure / vulnerability reporting channel?**
Yes. security@partsport.agentgaming.gg. We acknowledge reports within 5 business days and do not pursue legal action against good-faith research within scope.

**21. Are penetration tests performed?**
Not at this time. A first third-party penetration test is planned alongside SOC 2 Type II readiness work.

## G. Network and infrastructure security

**22. Are inbound webhooks authenticated?**
Yes. Stripe webhooks use signed events with timestamp drift checks. Resend inbound webhooks use Svix signatures verified server-side with a 5-minute timestamp drift window. Internal cron endpoints require a shared CRON_SECRET and fail closed when unset.

**23. Do you rate-limit endpoints?**
Yes. Upstash Redis backs production rate limiting across authentication, search, messaging, supplier mutating endpoints, AI features, and inbound webhooks.

**24. Is the application multi-tenant?**
Yes. Tenant isolation is enforced in the application layer with role and ownership checks on every authenticated request. There is no shared cross-tenant query path.

## H. Employee security

**25. Do employees and contractors sign confidentiality agreements?**
Yes.

**26. Is security awareness training provided?**
Annual security awareness training is in development. Founders and any contractor with production access receive a baseline briefing on credential hygiene, phishing, and incident escalation today.

**27. How is access revoked on staff change?**
Provider console access is removed and signing secrets that the departing party knew (SESSION_SECRET, CRON_SECRET, INBOUND_WEBHOOK_SECRET, RESEND_API_KEY) are rotated within 24 hours of separation.

## I. Vendor management

**28. Do you use Sub-processors?**
Yes. The current authoritative list is published at /legal/subprocessors. Each Sub-processor is bound by a written agreement with appropriate confidentiality and data protection terms.

**29. How are Sub-processors evaluated and re-evaluated?**
Each provider is reviewed at onboarding for SOC 2 / ISO 27001 status, data residency, breach history, and contractual data protection terms. We monitor provider status pages and security bulletins on an ongoing basis.

**30. Will you sign our DPA?**
We will sign your DPA on review for material conflicts with our standard DPA published at /legal/dpa. We strongly prefer execution of our own DPA, which is GDPR / CCPA compliant and incorporates Standard Contractual Clauses for EEA / UK / Swiss transfers where applicable.

## J. Compliance and audits

**31. What attestations or certifications do you hold?**
None at this time. We are working toward SOC 2 Type II readiness. We do not hold SOC 2, ISO 27001, PCI DSS service provider, HIPAA, or FedRAMP attestations. Stripe handles the cardholder data environment under its own PCI DSS Level 1 certification.

**32. Can you provide a SOC 2 report?**
Not at this time. We will publish attestation status at /legal/security when available.

**33. Do you accept right-to-audit?**
Per the DPA, customers may, on reasonable notice and no more than once per twelve-month period, conduct a scoped audit of PartsPort's compliance with the DPA, subject to confidentiality and at customer's cost unless material non-compliance is identified.

## K. Data retention and deletion

**34. How long is customer data retained?**
Account data is retained while the account is active. Identifying data is anonymized on account closure with a 30-day recovery grace period before hard deletion. Financial and transaction records are retained for seven years to satisfy IRS and equivalent record-keeping requirements. Audit log entries are retained for 90 days.

**35. Can customers request deletion?**
Yes, in accordance with GDPR / CCPA rights described in the Privacy Policy. Email privacy@partsport.agentgaming.gg.

## L. Contact

Procurement, DPA, and security questionnaire owner: legal@partsport.agentgaming.gg. Security incidents and vulnerability reports: security@partsport.agentgaming.gg.
