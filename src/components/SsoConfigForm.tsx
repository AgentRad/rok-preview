"use client";

import { useState } from "react";

type View = {
  exists: boolean;
  idpType: "SAML" | "OIDC";
  spEntityId: string;
  acsUrl: string;
  metadataUrl: string;
  oidcCallbackUrl: string;
  idpEntityId: string;
  idpSsoUrl: string;
  idpSloUrl: string;
  idpX509Cert: string;
  idpX509CertNext: string;
  oidcIssuer: string;
  oidcClientId: string;
  oidcClientSecretSet: boolean;
  domainAllowlist: string[];
  groupAttributeName: string;
  groupRoleMap: Record<string, string>;
  defaultRole: string;
  enforced: boolean;
  sessionMaxAgeMin: number;
  honorIdpSessionExpiry: boolean;
  rotatedCertAt: string | null;
  scimEnabled: boolean;
  scimTokenLast4: string | null;
  scimUrlBase: string;
};

const ROLES = ["VIEWER", "BUYER", "APPROVER", "ADMIN"];

export default function SsoConfigForm({
  endpoint,
  initial,
}: {
  endpoint: string;
  initial: View;
}) {
  const actionsEndpoint = `${endpoint}/actions`;
  const [v, setV] = useState<View>(initial);
  const [form, setForm] = useState({
    idpType: initial.idpType,
    idpEntityId: initial.idpEntityId,
    idpSsoUrl: initial.idpSsoUrl,
    idpSloUrl: initial.idpSloUrl,
    idpX509Cert: initial.idpX509Cert,
    idpX509CertNext: initial.idpX509CertNext,
    oidcIssuer: initial.oidcIssuer,
    oidcClientId: initial.oidcClientId,
    oidcClientSecret: "",
    domainAllowlist: initial.domainAllowlist.join(", "),
    groupAttributeName: initial.groupAttributeName,
    groupRoleMap: JSON.stringify(initial.groupRoleMap, null, 2),
    defaultRole: initial.defaultRole,
    enforced: initial.enforced,
    sessionMaxAgeMin: initial.sessionMaxAgeMin,
    honorIdpSessionExpiry: initial.honorIdpSessionExpiry,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [certNext, setCertNext] = useState("");
  const [newScimToken, setNewScimToken] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, val: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: val }));
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMsg({ ok: true, text: "Copied to clipboard." });
    } catch {
      setMsg({ ok: false, text: "Copy failed. Select and copy manually." });
    }
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: data.error || "Save failed." });
      } else {
        setV(data);
        set("oidcClientSecret", "");
        setMsg({ ok: true, text: "SSO configuration saved." });
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Remove this SSO configuration? Members fall back to password login.")) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(endpoint, { method: "DELETE" });
      if (res.ok) {
        setV({ ...v, exists: false });
        setMsg({ ok: true, text: "SSO configuration removed." });
      } else {
        setMsg({ ok: false, text: "Remove failed." });
      }
    } finally {
      setBusy(false);
    }
  }

  async function action(body: Record<string, unknown>): Promise<{ ok: boolean; token?: string; view?: View; error?: string }> {
    const res = await fetch(actionsEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function rotateScim() {
    if (v.scimEnabled && !confirm("Regenerate the SCIM token? The current token stops working immediately.")) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const data = await action({ action: "scim-rotate" });
      if (data.token) {
        setNewScimToken(data.token);
        setV({ ...v, scimEnabled: true, scimTokenLast4: data.token.slice(-4) });
        setMsg({ ok: true, text: "SCIM token generated. Copy it now: it is shown only once." });
      } else {
        setMsg({ ok: false, text: data.error || "Could not generate token." });
      }
    } finally {
      setBusy(false);
    }
  }

  async function disableScim() {
    setBusy(true);
    setMsg(null);
    try {
      const data = await action({ action: "scim-disable" });
      if (data.ok) {
        setNewScimToken(null);
        setV({ ...v, scimEnabled: false, scimTokenLast4: null });
        setMsg({ ok: true, text: "SCIM disabled." });
      } else {
        setMsg({ ok: false, text: data.error || "Could not disable SCIM." });
      }
    } finally {
      setBusy(false);
    }
  }

  async function stageCert() {
    setBusy(true);
    setMsg(null);
    try {
      const data = await action({ action: "cert-stage", certNext });
      if (data.ok && data.view) {
        setV(data.view);
        setCertNext("");
        setMsg({ ok: true, text: "Next certificate staged. The ACS now accepts either cert." });
      } else {
        setMsg({ ok: false, text: data.error || "Could not stage cert." });
      }
    } finally {
      setBusy(false);
    }
  }

  async function activateCert() {
    if (!confirm("Activate the staged certificate? It becomes the only accepted cert.")) return;
    setBusy(true);
    setMsg(null);
    try {
      const data = await action({ action: "cert-activate" });
      if (data.ok && data.view) {
        setV(data.view);
        setMsg({ ok: true, text: "Staged certificate promoted to current." });
      } else {
        setMsg({ ok: false, text: data.error || "Could not activate cert." });
      }
    } finally {
      setBusy(false);
    }
  }

  const isOidc = form.idpType === "OIDC";

  return (
    <div className="stack-lg">
      {msg && (
        <div className={`alert ${msg.ok ? "alert-success" : "alert-error"}`}>
          {msg.text}
        </div>
      )}

      <section className="card">
        <h2 className="card-title">Identity provider type</h2>
        <label className="field">
          <span>Protocol</span>
          <select
            value={form.idpType}
            onChange={(e) => set("idpType", e.target.value as "SAML" | "OIDC")}
          >
            <option value="SAML">SAML 2.0 (Okta, Azure AD, Ping, OneLogin, ADFS)</option>
            <option value="OIDC">OIDC (Google Workspace, Okta OIDC, Azure AD OIDC)</option>
          </select>
        </label>
      </section>

      {!isOidc && (
        <section className="card">
          <h2 className="card-title">1. Give these to your IdP (SAML)</h2>
          <p className="page-sub">
            Paste the metadata URL into your IdP to configure PartsPort as a
            Service Provider, or enter the two values below by hand.
          </p>
          <dl className="kv">
            <dt>SP metadata URL</dt>
            <dd>
              <code>{v.metadataUrl}</code>{" "}
              <button className="btn btn-ghost btn-sm" onClick={() => copy(v.metadataUrl)}>Copy</button>
            </dd>
            <dt>SP Entity ID (Audience)</dt>
            <dd>
              <code>{v.spEntityId}</code>{" "}
              <button className="btn btn-ghost btn-sm" onClick={() => copy(v.spEntityId)}>Copy</button>
            </dd>
            <dt>ACS URL (Reply / Single sign-on URL)</dt>
            <dd>
              <code>{v.acsUrl}</code>{" "}
              <button className="btn btn-ghost btn-sm" onClick={() => copy(v.acsUrl)}>Copy</button>
            </dd>
          </dl>
        </section>
      )}

      {isOidc && (
        <section className="card">
          <h2 className="card-title">1. Give this to your IdP (OIDC)</h2>
          <p className="page-sub">
            Register PartsPort as a web application in your IdP and add this
            redirect URI. Then paste the issuer, client ID, and client secret
            below.
          </p>
          <dl className="kv">
            <dt>Redirect URI (callback)</dt>
            <dd>
              <code>{v.oidcCallbackUrl}</code>{" "}
              <button className="btn btn-ghost btn-sm" onClick={() => copy(v.oidcCallbackUrl)}>Copy</button>
            </dd>
          </dl>
        </section>
      )}

      {!isOidc && (
        <section className="card">
          <h2 className="card-title">2. Enter your IdP details (SAML)</h2>
          <label className="field">
            <span>IdP Entity ID / Issuer</span>
            <input value={form.idpEntityId} onChange={(e) => set("idpEntityId", e.target.value)} placeholder="http://www.okta.com/exk..." />
          </label>
          <label className="field">
            <span>IdP SSO URL (SingleSignOnService)</span>
            <input value={form.idpSsoUrl} onChange={(e) => set("idpSsoUrl", e.target.value)} placeholder="https://your-org.okta.com/app/.../sso/saml" />
          </label>
          <label className="field">
            <span>IdP SLO URL (optional)</span>
            <input value={form.idpSloUrl} onChange={(e) => set("idpSloUrl", e.target.value)} placeholder="https://your-org.okta.com/app/.../slo/saml" />
          </label>
          <label className="field">
            <span>IdP signing certificate (PEM)</span>
            <textarea rows={6} value={form.idpX509Cert} onChange={(e) => set("idpX509Cert", e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" />
          </label>
          {v.rotatedCertAt && (
            <p className="muted">Last cert rotation: {new Date(v.rotatedCertAt).toLocaleString()}</p>
          )}
        </section>
      )}

      {isOidc && (
        <section className="card">
          <h2 className="card-title">2. Enter your IdP details (OIDC)</h2>
          <label className="field">
            <span>Issuer URL</span>
            <input value={form.oidcIssuer} onChange={(e) => set("oidcIssuer", e.target.value)} placeholder="https://accounts.google.com" />
          </label>
          <label className="field">
            <span>Client ID</span>
            <input value={form.oidcClientId} onChange={(e) => set("oidcClientId", e.target.value)} placeholder="1234567890-abc.apps.googleusercontent.com" />
          </label>
          <label className="field">
            <span>Client secret {v.oidcClientSecretSet ? "(saved; leave blank to keep)" : ""}</span>
            <input
              type="password"
              value={form.oidcClientSecret}
              onChange={(e) => set("oidcClientSecret", e.target.value)}
              placeholder={v.oidcClientSecretSet ? "••••••••" : "Paste the client secret"}
            />
          </label>
        </section>
      )}

      {!isOidc && v.exists && (
        <section className="card">
          <h2 className="card-title">Certificate rotation</h2>
          <p className="page-sub">
            Stage your IdP&apos;s next signing certificate before the IdP flips
            to it. During the window the ACS accepts an assertion signed by
            either the current or the staged cert. Once the IdP has fully
            switched, activate to promote the staged cert to current.
          </p>
          {v.idpX509CertNext ? (
            <div className="stack-sm">
              <p className="muted">A next certificate is currently staged.</p>
              <button className="btn btn-primary" disabled={busy} onClick={activateCert}>
                Activate staged certificate
              </button>
            </div>
          ) : (
            <div className="stack-sm">
              <label className="field">
                <span>Next signing certificate (PEM)</span>
                <textarea rows={4} value={certNext} onChange={(e) => setCertNext(e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" />
              </label>
              <button className="btn btn-ghost" disabled={busy || !certNext.trim()} onClick={stageCert}>
                Stage next certificate
              </button>
            </div>
          )}
        </section>
      )}

      <section className="card">
        <h2 className="card-title">3. Provisioning and policy</h2>
        <label className="field">
          <span>Allowed email domains (comma or space separated)</span>
          <input value={form.domainAllowlist} onChange={(e) => set("domainAllowlist", e.target.value)} placeholder="acme.com, acme.co.uk" />
        </label>
        {!isOidc && (
          <label className="field">
            <span>Group attribute name (optional)</span>
            <input value={form.groupAttributeName} onChange={(e) => set("groupAttributeName", e.target.value)} placeholder="memberOf" />
          </label>
        )}
        <label className="field">
          <span>Group to role map (JSON)</span>
          <textarea rows={5} value={form.groupRoleMap} onChange={(e) => set("groupRoleMap", e.target.value)} placeholder='{ "Procurement-Admins": "ADMIN", "Buyers": "BUYER" }' />
        </label>
        <label className="field">
          <span>Default role (no matching group)</span>
          <select value={form.defaultRole} onChange={(e) => set("defaultRole", e.target.value)}>
            {ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
          </select>
        </label>
        <label className="field">
          <span>Session max age (minutes)</span>
          <input type="number" min={5} max={43200} value={form.sessionMaxAgeMin} onChange={(e) => set("sessionMaxAgeMin", Number(e.target.value))} />
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={form.honorIdpSessionExpiry} onChange={(e) => set("honorIdpSessionExpiry", e.target.checked)} />
          <span>Honor the IdP session expiry when shorter than the max age</span>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={form.enforced} onChange={(e) => set("enforced", e.target.checked)} />
          <span>
            Enforce SSO: disable password login for users in the allowed
            domains. A platform admin and any member granted emergency access
            keep a break-glass password path.
          </span>
        </label>
      </section>

      <div className="row gap">
        <button className="btn btn-primary" disabled={busy} onClick={save}>
          {busy ? "Saving..." : "Save SSO configuration"}
        </button>
        {v.exists && (
          <button className="btn btn-ghost" disabled={busy} onClick={remove}>Remove SSO</button>
        )}
      </div>

      {v.exists && (
        <section className="card">
          <h2 className="card-title">SCIM provisioning (auto-provision and deprovision)</h2>
          <p className="page-sub">
            Issue a bearer token and paste it plus the base URL into your IdP&apos;s
            SCIM integration. The token is shown only once. Regenerating
            invalidates the previous token.
          </p>
          <dl className="kv">
            <dt>SCIM Base URL</dt>
            <dd>
              <code>{v.scimUrlBase}</code>{" "}
              <button className="btn btn-ghost btn-sm" onClick={() => copy(v.scimUrlBase)}>Copy</button>
            </dd>
            <dt>Status</dt>
            <dd>
              {v.scimEnabled
                ? `Enabled. Token ends in ...${v.scimTokenLast4 ?? "????"}`
                : "Disabled."}
            </dd>
          </dl>
          {newScimToken && (
            <div className="alert alert-success">
              <p><strong>Copy this token now. It will not be shown again.</strong></p>
              <p><code style={{ wordBreak: "break-all" }}>{newScimToken}</code></p>
              <button className="btn btn-ghost btn-sm" onClick={() => copy(newScimToken)}>Copy token</button>
            </div>
          )}
          <div className="row gap">
            <button className="btn btn-primary" disabled={busy} onClick={rotateScim}>
              {v.scimEnabled ? "Regenerate SCIM token" : "Generate SCIM token"}
            </button>
            {v.scimEnabled && (
              <button className="btn btn-ghost" disabled={busy} onClick={disableScim}>Disable SCIM</button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
