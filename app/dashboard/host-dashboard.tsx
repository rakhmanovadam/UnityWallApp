"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

type Event = {
  id: string;
  code: string;
  couple_display: string;
  when_text: string;
  status: "draft" | "live" | "archived";
  wall_layout: string;
  allow_uploads: boolean;
  require_moderation: boolean;
};

export default function HostDashboard({
  event: initialEvent,
  hostEmail,
  joinUrl,
  qrSvg,
}: {
  event: Event;
  hostEmail: string;
  joinUrl: string;
  qrSvg: string;
}) {
  const [event, setEvent] = useState(initialEvent);
  const [metrics, setMetrics] = useState<{ photos: number; guests: number; optins: number } | null>(
    null,
  );
  const [pending, setPending] = useState<number>(0);
  const supabase = createClient();

  useEffect(() => {
    let mounted = true;
    async function loadMetrics() {
      const { data: photos } = await supabase
        .from("photos")
        .select("status")
        .eq("event_id", event.id);
      const { data: guests } = await supabase
        .from("guests")
        .select("marketing_opt_in, verified_at")
        .eq("event_id", event.id);
      if (!mounted) return;
      const approved = (photos ?? []).filter((p) => p.status === "approved").length;
      const pendingCount = (photos ?? []).filter((p) => p.status === "pending").length;
      const verified = (guests ?? []).filter((g) => g.verified_at).length;
      const optins = (guests ?? []).filter((g) => g.marketing_opt_in).length;
      setMetrics({ photos: approved, guests: verified, optins });
      setPending(pendingCount);
    }
    void loadMetrics();
    return () => {
      mounted = false;
    };
  }, [supabase, event.id]);

  async function patch(patchData: Partial<Event>) {
    const next = { ...event, ...patchData };
    setEvent(next);
    try {
      await fetch(`/api/host/events/${encodeURIComponent(event.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchData),
      });
    } catch {
      // Revert on hard failure could go here; for now we leave the
      // optimistic update and surface the next page load.
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  return (
    <section className="screen screen--scroll">
      <div className="host__top">
        <span className="kicker kicker--dusk">
          Your wall · {event.when_text}
        </span>
        <h1
          className="display display--med"
          dangerouslySetInnerHTML={{
            __html: event.couple_display
              .replace(/&/g, "<em>&amp;</em>")
              .replace(/\s<em>&amp;<\/em>\s/g, " <em>&amp;</em> "),
          }}
        />
      </div>
      <div className="host__cover cover__art--01" />

      <div className="metrics">
        <div className="metric">
          <span className="metric__n">{metrics?.photos ?? "—"}</span>
          <span className="kicker kicker--mute">Photos</span>
        </div>
        <div className="metric">
          <span className="metric__n">{metrics?.guests ?? "—"}</span>
          <span className="kicker kicker--mute">Guests</span>
        </div>
        <div className="metric">
          <span className="metric__n metric__n--dusk">
            {metrics?.optins ?? "—"}
          </span>
          <span className="kicker kicker--mute">Opt-ins</span>
        </div>
      </div>

      <div className="card card--qr">
        <div
          className="qr qr--sm"
          id="host-qr"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
        <div>
          <div className="card__t">Share the wall</div>
          <div className="card__sub">{joinUrl.replace(/^https?:\/\//, "")}</div>
        </div>
      </div>

      <div className="host__actions">
        <Link
          className="btn btn--primary"
          href={`/join/${encodeURIComponent(event.code)}/wall`}
        >
          View the wall
        </Link>
        <Link
          className="btn btn--icon"
          href="/dashboard/card"
          aria-label="Open shareable card"
        >
          ↗
        </Link>
      </div>

      <Link
        className="row row--toggle"
        href={`/dashboard?moderation=1`}
        style={{ textDecoration: "none" }}
      >
        <div>
          <div className="row__t">Moderation queue</div>
          <div className="row__sub">
            {pending > 0
              ? `${pending} photo${pending === 1 ? "" : "s"} waiting`
              : "Nothing waiting"}
          </div>
        </div>
        <span className="cta-row__arrow" style={{ color: "var(--dusk)" }}>
          →
        </span>
      </Link>

      <div className="row row--toggle">
        <div>
          <div className="row__t">Review before posting</div>
          <div className="row__sub">
            New photos wait for your nod
          </div>
        </div>
        <button
          type="button"
          className="toggle"
          data-on={event.require_moderation ? "true" : "false"}
          aria-pressed={event.require_moderation}
          onClick={() =>
            patch({ require_moderation: !event.require_moderation })
          }
        >
          <span />
        </button>
      </div>

      <div className="card card--layouts">
        <div className="kicker kicker--mute">Gallery layout</div>
        <div className="layout-picker">
          {(["mosaic", "feature", "grid"] as const).map((l) => (
            <button
              key={l}
              type="button"
              className={"lp" + (event.wall_layout === l ? " lp--on" : "")}
              data-l={l}
              onClick={() => patch({ wall_layout: l })}
            >
              <span className={`lp__icon lp__icon--${l}`} />
              <span>{l[0].toUpperCase() + l.slice(1)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="row row--toggle">
        <div>
          <div className="row__t">Upload window</div>
          <div className="row__sub">
            {event.allow_uploads ? "Open" : "Closed"}
          </div>
        </div>
        <button
          type="button"
          className="toggle"
          data-on={event.allow_uploads ? "true" : "false"}
          aria-pressed={event.allow_uploads}
          onClick={() => patch({ allow_uploads: !event.allow_uploads })}
        >
          <span />
        </button>
      </div>

      <Link
        className="row row--toggle"
        href="/dashboard/slideshow"
        style={{ textDecoration: "none" }}
      >
        <div>
          <div className="row__t">Projector / live wall</div>
          <div className="row__sub">Full-bleed slideshow for the room</div>
        </div>
        <span className="cta-row__arrow" style={{ color: "var(--dusk)" }}>
          →
        </span>
      </Link>

      <div className="info">
        <div className="info__head">
          <span className="dot dot--dusk" />
          Photos kept 60 days after the event
        </div>
        <div className="info__body">
          We&apos;ll remind you to download at day 50.
        </div>
      </div>

      <div className="powered" style={{ marginTop: 28 }}>
        <span className="brandmark brandmark--xs" />
        <span>
          Signed in as {hostEmail} ·{" "}
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
