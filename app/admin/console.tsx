"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import MasterEmails, {
  type MasterRow,
  type FunnelCounts,
} from "./master-emails";

type Application = {
  id: string;
  venue: string;
  contact: string;
  email: string;
  phone: string | null;
  city: string | null;
  country: string | null;
  notes: string | null;
  status: string;
  created_at: string;
};

export default function AdminConsole({
  email,
  metrics,
  applications: initialApps,
  emails,
}: {
  email: string;
  metrics: { emails: number; venues: number; pending: number };
  applications: Application[];
  emails: { items: MasterRow[]; total: number; counts: FunnelCounts };
}) {
  const supabase = createClient();
  const [apps, setApps] = useState<Application[]>(initialApps);
  const [busyId, setBusyId] = useState<string | null>(null);
  // When set, the console renders an inline decline modal for that
  // application, prompting the reviewer for an optional reason before the
  // PATCH goes out.
  const [decliningApp, setDecliningApp] = useState<Application | null>(null);

  async function approve(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(
        `/api/admin/applications/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve" }),
        },
      );
      if (res.ok) {
        setApps((prev) => prev.filter((a) => a.id !== id));
      }
    } finally {
      setBusyId(null);
    }
  }

  async function declineWithReason(id: string, reason: string | null) {
    setBusyId(id);
    try {
      const res = await fetch(
        `/api/admin/applications/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "decline", reason }),
        },
      );
      if (res.ok) {
        setApps((prev) => prev.filter((a) => a.id !== id));
        setDecliningApp(null);
      }
    } finally {
      setBusyId(null);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  const convertPct =
    metrics.emails > 0
      ? ((metrics.venues / metrics.emails) * 100).toFixed(1) + "%"
      : "—";

  return (
    <section className="screen screen--scroll">
      <div className="admin__top">
        <div>
          <span className="kicker kicker--dusk">UnityWall · Admin</span>
          <div className="wall__title">Control room</div>
        </div>
        <span className="brandmark brandmark--sm" />
      </div>

      <div className="metrics metrics--admin">
        <div className="metric">
          <span className="metric__n">{metrics.emails.toLocaleString()}</span>
          <span className="kicker kicker--mute">Emails</span>
        </div>
        <div className="metric">
          <span className="metric__n">{metrics.venues}</span>
          <span className="kicker kicker--mute">Venues</span>
        </div>
        <div className="metric">
          <span className="metric__n metric__n--dusk">{metrics.pending}</span>
          <span className="kicker kicker--mute">Pending</span>
        </div>
        <div className="metric">
          <span className="metric__n">{convertPct}</span>
          <span className="kicker kicker--mute">Convert</span>
        </div>
      </div>

      <div className="section-label">Application queue</div>
      {apps.length === 0 ? (
        <div className="info">
          <div className="info__head">
            <span className="dot dot--dusk" />
            Inbox zero
          </div>
          <div className="info__body">
            No applications waiting on you right now.
          </div>
        </div>
      ) : (
        apps.map((app) => (
          <div className="appcard" key={app.id}>
            <div className="appcard__t">{app.venue}</div>
            <div className="appcard__sub">
              {app.contact}
              {app.city || app.country
                ? ` · ${[app.city, app.country].filter(Boolean).join(", ")}`
                : ""}{" "}
              · {app.email}
            </div>
            {app.notes ? (
              <p className="microcopy" style={{ marginTop: 10 }}>
                {app.notes}
              </p>
            ) : null}
            <div className="appcard__actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => approve(app.id)}
                disabled={busyId === app.id}
              >
                {busyId === app.id ? "Approving…" : "Approve"}
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setDecliningApp(app)}
                disabled={busyId === app.id}
              >
                Decline
              </button>
            </div>
          </div>
        ))
      )}

      {decliningApp ? (
        <DeclineModal
          app={decliningApp}
          busy={busyId === decliningApp.id}
          onCancel={() => setDecliningApp(null)}
          onConfirm={(reason) => declineWithReason(decliningApp.id, reason)}
        />
      ) : null}

      <div className="section-label">Collected emails</div>
      <MasterEmails initial={emails} />

      <div className="powered" style={{ marginTop: 28 }}>
        <span className="brandmark brandmark--xs" />
        <span>
          Signed in as {email} ·{" "}
          <button
            type="button"
            className="ulink"
            onClick={signOut}
            style={{ background: "none", border: 0, padding: 0 }}
          >
            Sign out
          </button>
        </span>
      </div>
    </section>
  );
}

// Small controlled dialog for declining an application. The reason is
// optional but stored + emailed when supplied — the plan explicitly calls
// out that "declines capture a reason" so a future review-by-committee can
// see why an earlier round didn't move forward.
function DeclineModal({
  app,
  busy,
  onCancel,
  onConfirm,
}: {
  app: Application;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string | null) => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="decline-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20, 20, 30, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 50,
      }}
      onClick={(e) => {
        // Backdrop click cancels — but only when the click is on the
        // backdrop itself, not a bubble from the inner panel.
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="card"
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: 20,
          maxWidth: 440,
          width: "100%",
          boxShadow: "0 20px 40px rgba(20,20,30,0.25)",
        }}
      >
        <div className="kicker kicker--dusk">Decline application</div>
        <h2 id="decline-title" className="display display--sm" style={{ margin: "8px 0 4px" }}>
          {app.venue}
        </h2>
        <p className="microcopy" style={{ marginBottom: 14 }}>
          The applicant ({app.contact}, {app.email}) will get an email letting
          them know. If you leave a note, we include it verbatim.
        </p>
        <label className="label" htmlFor="reason-input">
          Reason <span style={{ color: "#888" }}>(optional)</span>
        </label>
        <div className="field">
          <textarea
            id="reason-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="e.g. Outside our current service area — happy to reconnect once we expand."
            disabled={busy}
            style={{
              width: "100%",
              resize: "vertical",
              fontFamily: "inherit",
              fontSize: "inherit",
              padding: "10px 12px",
              border: 0,
              background: "transparent",
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => onConfirm(reason.trim() ? reason : null)}
            disabled={busy}
          >
            {busy ? "Declining…" : "Send decline"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={onCancel}
            disabled={busy}
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
