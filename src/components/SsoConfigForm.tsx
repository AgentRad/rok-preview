"use client";

import { useState } from "react";

type View = {
  exists: boolean;
  spEntityId: string;
  acsUrl: string;
  metadataUrl: string;
  idpEntityId: string;
  idpSsoUrl: string;
  idpSloUrl: string;
  idpX509Cert: string;
  idpX509CertNext: string;
  domainAllowlist: string[];
  groupAttributeName: string;
  groupRoleMap: Record<string, string>;
  defaultRole: string;
  enforced: boolean;
  sessionMaxAgeMin: number;
  honorIdpSessionExpiry: boolean;
  rotatedCertAt: string | null;
};

const ROLES = ["VIEWER", "BUYER", "APPROVER", "ADMIN"];

export default function SsoConfigForm({
  endpoint,
  initial,
}: {
  endpoint: string;
  initial: View;
}) {
  const [v, setV] = useState<View>(initial);
  const [form, setForm] = useState({
    idpEntityId: initial.idpEntityId,
    idpSsoUrl: initial.idpSsoUrl,
    idpSloUrl: initial.idpSloUrl,
    idpX509Cert: initial.idpX509Cert,
    idpX509CertNext: initial.idpX509CertNext,
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

  return (
    <div className="stack-lg">
      {msg && (
        <div className={`alert ${msg.ok ? "alert-success" : "alert-error"}`}>
          {msg.text}
        </div>
      )}

      <section className="card">
        <h2 className="card-title">1. Give these to your IdP</h2>
        <p className="page-sub">
          Paste the metadata URL into your IdP (Okta, Azure AD, or any SAML 2.0
          provider) to configure PartsPort as a Service Provider, or enter the
          two values below by hand.
        </p>
        <dl className="kv">
          <dt>SP metadata URL</dt>
          <dd>
            <code>{v.metadataUrl}</code>{" "}
            <button className="btn btn-ghost btn-sm" onClick={() => copy(v.metadataUrl)}>
              Copy
            </button>
          </dd>
          <dt>SP Entity ID (Audience)</dt>
          <dd>
            <code>{v.spEntityId}</code>{" "}
            <button className="btn btn-ghost btn-sm" onClick={() => copy(v.spEntityId)}>
              Copy
            </button>
          </dd>
          <dt>ACS URL (Reply / Single sign-on URL)</dt>
          <dd>
            <code>{v.acsUrl}</code>{" "}
            <button className="btn btn-ghost btn-sm" onClick={() => copy(v.acsUrl)}>
              Copy
            </button>
          </dd>
        </dl>
      </section>

      <section className="card">
        <h2 className="card-title">2. Enter your IdP details</h2>
        <label className="field">
          <span>IdP Entity ID / Issuer</span>
          <input
            value={form.idpEntityId}
            onChange={(e) => set("idpEntityId", e.target.value)}
            placeholder="http://www.okta.com/exk..."
          />
        </label>
        <label className="field">
          <span>IdP SSO URL (SingleSignOnService)</span>
          <input
            value={form.idpSsoUrl}
            onChange={(e) => set("idpSsoUrl", e.target.value)}
            placeholder="https://your-org.okta.com/app/.../sso/saml"
          />
        </label>
        <label className="field">
          <span>IdP SLO URL (optional)</span>
          <input
            value={form.idpSloUrl}
            onChange={(e) => set("idpSloUrl", e.target.value)}
            placeholder="https://your-org.okta.com/app/.../slo/saml"
          />
        </label>
        <label className="field">
          <span>IdP signing certificate (PEM)</span>
          <textarea
            rows={6}
            value={form.idpX509Cert}
            onChange={(e) => set("idpX509Cert", e.target.value)}
            placeholder="-----BEGIN CERTIFICATE-----"
          />
        </label>
        <label className="field">
          <span>Next signing certificate (optional, for zero-downtime rotation)</span>
          <textarea
            rows={4}
            value={form.idpX509CertNext}
            onChange={(e) => set("idpX509CertNext", e.target.value)}
            placeholder="-----BEGIN CERTIFICATE-----"
          />
        </label>
        {v.rotatedCertAt && (
          <p className="muted">
            Last cert rotation: {new Date(v.rotatedCertAt).toLocaleString()}
          </p>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">3. Provisioning and policy</h2>
        <label className="field">
          <span>Allowed email domains (comma or space separated)</span>
          <input
            value={form.domainAllowlist}
            onChange={(e) => set("domainAllowlist", e.target.value)}
            placeholder="acme.com, acme.co.uk"
          />
        </label>
        <label className="field">
          <span>Group attribute name (optional)</span>
          <input
            value={form.groupAttributeName}
            onChange={(e) => set("groupAttributeName", e.target.value)}
            placeholder="memberOf"
          />
        </label>
        <label className="field">
          <span>Group to role map (JSON)</span>
          <textarea
            rows={5}
            value={form.groupRoleMap}
            onChange={(e) => set("groupRoleMap", e.target.value)}
            placeholder='{ "Procurement-Admins": "ADMIN", "Buyers": "BUYER" }'
          />
        </label>
        <label className="field">
          <span>Default role (no matching group)</span>
          <select
            value={form.defaultRole}
            onChange={(e) => set("defaultRole", e.target.value)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Session max age (minutes)</span>
          <input
            type="number"
            min={5}
            max={43200}
            value={form.sessionMaxAgeMin}
            onChange={(e) => set("sessionMaxAgeMin", Number(e.target.value))}
          />
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.honorIdpSessionExpiry}
            onChange={(e) => set("honorIdpSessionExpiry", e.target.checked)}
          />
          <span>Honor the IdP session expiry when shorter than the max age</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.enforced}
            onChange={(e) => set("enforced", e.target.checked)}
          />
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
          <button className="btn btn-ghost" disabled={busy} onClick={remove}>
            Remove SSO
          </button>
        )}
      </div>
    </div>
  );
}
