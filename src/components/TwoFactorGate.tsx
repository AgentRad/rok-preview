import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getTwoFactorState } from "@/lib/two-factor-policy";

/**
 * PLH-3w P2: per-role 2FA enforcement chrome. Renders nothing for users
 * who don't need 2FA or already have it. Matching users with 2FA off see
 * a thin banner during the 24h grace window, then a blocking interstitial
 * once grace expires (unless an admin granted a recovery override).
 *
 * Mounted once in the root layout so it covers every authenticated surface.
 */
export default async function TwoFactorGate() {
  const user = await getCurrentUser();
  if (!user) return null;
  const state = await getTwoFactorState(user);
  if (!state.required) return null;

  if (state.mustEnrollNow) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Two-factor authentication required"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "rgba(20, 20, 20, 0.72)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <div
          style={{
            background: "var(--surface, #fff)",
            borderRadius: 12,
            maxWidth: 460,
            width: "100%",
            padding: 28,
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: 20 }}>
            Two-factor authentication required
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.6 }}>
            Your role requires two-factor authentication. The grace period has
            ended, so you must enable it now to continue using PartsPort. It
            takes about a minute with any authenticator app.
          </p>
          <Link href="/settings" className="btn btn-primary">
            Set up 2FA now
          </Link>
          <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
            Locked out of your authenticator? Contact an admin to start a
            recovery.
          </p>
        </div>
      </div>
    );
  }

  if (state.inGrace) {
    return (
      <div
        role="status"
        style={{
          background: "#8a5a00",
          color: "#fff",
          padding: "10px 16px",
          fontSize: 13.5,
          textAlign: "center",
        }}
      >
        Two-factor authentication is required for your role.{" "}
        <Link href="/settings" style={{ color: "#fff", textDecoration: "underline" }}>
          Set it up
        </Link>{" "}
        before{" "}
        {state.graceEndsAt
          ? new Date(state.graceEndsAt).toLocaleString()
          : "your grace period ends"}
        .
      </div>
    );
  }

  return null;
}
