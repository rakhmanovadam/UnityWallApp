"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";

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

type Lead = {
  id: string;
  source: "warm" | "hot" | "request";
  email: string | null;
  name: string | null;
  created_at: string;
};

export default function AdminConsole({
  email,
  metrics,
  applications: initialApps,
  leads,
}: {
  email: string;
  metrics: { emails: number; venues: number; pending: number };
  applications: Application[];
  leads: Lead[];
}) {
  const supabase = createClient();
  const [apps, setApps] = useState<Application[]>(initialApps);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(id: string, action: "approve" | "decline") {
    setBusyId(id);
    try {
      const res = await fetch(
        `/api/admin/applications/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      if (res.ok) {
        setApps((prev) => prev.filter((a) => a.id !== id));
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
                onClick={() => decide(app.id, "approve")}
                disabled={busyId === app.id}
              >
                {busyId === app.id ? "Approving…" : "Approve"}
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => decide(app.id, "decline")}
                disabled={busyId === app.id}
              >
                Decline
              </button>
            </div>
          </div>
        ))
      )}

      <div className="section-label">Recent leads</div>
      <ul className="leads">
        {leads.map((lead) => (
          <li className="lead" key={lead.id}>
            <span
              className={`lead__dot lead__dot--${
                lead.source === "hot"
                  ? "hot"
                  : lead.source === "warm"
                    ? "warm"
                    : "cold"
              }`}
            />
            <div>
              <div className="lead__t">{lead.name ?? lead.email ?? "—"}</div>
              <div className="lead__sub">
                {lead.source}
                {" · "}
                {new Date(lead.created_at).toLocaleDateString()}
              </div>
            </div>
            <span
              className={`lead__tag${
                lead.source === "hot"
                  ? " lead__tag--hot"
                  : lead.source === "warm"
                    ? " lead__tag--warm"
                    : ""
              }`}
            >
              {lead.source[0].toUpperCase() + lead.source.slice(1)}
            </span>
          </li>
        ))}
        {leads.length === 0 ? (
          <li className="microcopy">No leads yet.</li>
        ) : null}
      </ul>

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
