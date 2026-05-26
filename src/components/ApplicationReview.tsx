"use client";

import { useState } from "react";

export type PendingApplication = {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  category: string;
  yearsTrading: string;
  certs: string;
  createdAt: string;
};

function Row({ app }: { app: PendingApplication }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function act(action: "approve" | "reject") {
    setBusy(true);
    const res = await fetch(`/api/admin/applications/${app.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setResult(data.error || "Action failed.");
      return;
    }
    if (action === "approve") {
      setResult(
        `Approved. ${data.loginEmail} has been emailed a password-reset link to finish setup.`
      );
    } else {
      setResult("Application rejected.");
    }
  }

  return (
    <tr>
      <td>
        <div style={{ fontWeight: 600 }}>{app.companyName}</div>
        <div className="muted-text" style={{ fontSize: 12 }}>
          {app.contactName} · {app.email}
        </div>
      </td>
      <td>{app.category}</td>
      <td>{app.yearsTrading}</td>
      <td style={{ maxWidth: 200 }}>
        <span className="muted-text" style={{ fontSize: 12.5 }}>
          {app.certs || "Not listed"}
        </span>
      </td>
      <td className="num">
        {result ? (
          <span
            className="muted-text"
            style={{ fontSize: 12, color: "var(--green)" }}
          >
            {result}
          </span>
        ) : (
          <div className="inline-form" style={{ justifyContent: "flex-end" }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => act("approve")}
              disabled={busy}
            >
              Approve
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => act("reject")}
              disabled={busy}
            >
              Reject
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

export default function ApplicationReview({
  applications,
}: {
  applications: PendingApplication[];
}) {
  if (applications.length === 0) {
    return (
      <div className="empty-block">
        <h3>No pending applications</h3>
        <p>New supplier applications will appear here for review.</p>
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Applicant</th>
            <th>Category</th>
            <th>Trading</th>
            <th>Certifications</th>
            <th><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {applications.map((a) => (
            <Row key={a.id} app={a} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
