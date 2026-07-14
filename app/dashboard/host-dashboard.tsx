"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { renderCoupleDisplay } from "@/lib/render";
import {
  THEME_FONTS,
  THEME_DEFAULTS,
  type ThemeFontKey,
} from "@/lib/venue-theme";

type Event = {
  id: string;
  code: string;
  couple_display: string;
  when_text: string;
  status: "draft" | "live" | "archived";
  wall_layout: string;
  allow_uploads: boolean;
  require_moderation: boolean;
  max_uploads_per_guest: number;
  welcome_message: string | null;
  cover_image_path: string | null;
  theme_primary: string | null;
  theme_accent: string | null;
  theme_bg: string | null;
  theme_font: string | null;
};

export default function HostDashboard({
  event: initialEvent,
  hostEmail,
  joinUrl,
  qrSvg,
  coverUrl,
}: {
  event: Event;
  hostEmail: string;
  joinUrl: string;
  qrSvg: string;
  coverUrl: string | null;
}) {
  const [event, setEvent] = useState(initialEvent);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

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

  async function copy(kind: "code" | "link", value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(kind);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1500);
  }

  return (
    <section className="screen screen--scroll">
      <div className="host__top">
        <span className="kicker kicker--dusk">
          Your wall · {event.when_text}
          {event.status === "draft" ? " · Draft" : null}
          {event.status === "archived" ? " · Archived" : null}
        </span>
        {/* Render couple_display as React children — not innerHTML — so a
            compromised host can't XSS themselves or a teammate. */}
        <h1 className="display display--med">
          {renderCoupleDisplay(event.couple_display)}
        </h1>
      </div>

      {event.status === "draft" ? (
        <div className="card" style={{ padding: 16, marginBottom: 8 }}>
          <div className="row__t">This wall isn&apos;t live yet</div>
          <div className="row__sub" style={{ marginBottom: 12 }}>
            Guests who scan the QR will hit a 404 until you publish. Have a look
            at the details below first — you can always come back and edit.
          </div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => patch({ status: "live" })}
          >
            Publish wall
          </button>
        </div>
      ) : event.status === "live" ? (
        <div
          className="row row--toggle"
          style={{ borderColor: "var(--dusk)" }}
        >
          <div>
            <div className="row__t">Wall is live</div>
            <div className="row__sub">
              QR opens the join page. Unpublish to pause guest access.
            </div>
          </div>
          <button
            type="button"
            className="ulink"
            onClick={() => patch({ status: "draft" })}
          >
            Unpublish
          </button>
        </div>
      ) : null}
      <BannerUpload
        eventId={event.id}
        initialUrl={coverUrl}
        hasCover={Boolean(event.cover_image_path)}
        onChanged={(path) => setEvent({ ...event, cover_image_path: path })}
      />

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
        <div className="share__body">
          <div className="card__t">Share the wall</div>
          <div className="card__sub">{joinUrl.replace(/^https?:\/\//, "")}</div>
          <div className="share__code">
            <span className="kicker kicker--mute">Join code</span>
            <code className="share__code-val">{event.code}</code>
          </div>
          <div className="share__copies">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => copy("code", event.code)}
            >
              {copied === "code" ? "Copied ✓" : "Copy code"}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => copy("link", joinUrl)}
            >
              {copied === "link" ? "Copied ✓" : "Copy link"}
            </button>
          </div>
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
        href="/dashboard/moderation"
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

      <EditableDetails
        eventId={event.id}
        coupleDisplay={event.couple_display}
        whenText={event.when_text}
        welcomeMessage={event.welcome_message}
        onSaved={(patched) => setEvent({ ...event, ...patched })}
      />

      <DownloadAll eventId={event.id} eventCode={event.code} />

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

      <UploadLimit
        value={event.max_uploads_per_guest}
        onCommit={(n) => patch({ max_uploads_per_guest: n })}
      />

      <VenueDesign event={event} onPatch={patch} />

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
          Your wall closes 60 days after the event
        </div>
        <div className="info__body">
          We&apos;ll email you closing reminders 14 days and 3 days before it
          goes offline and photos are removed.
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

// Per-guest upload cap. A stepper + number input; commits to the server on
// blur / button so dragging the value doesn't fire a PATCH per keystroke.
function UploadLimit({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  function commit(raw: string) {
    const n = Math.max(1, Math.min(500, Math.round(Number(raw) || 0)));
    setDraft(String(n));
    if (n !== value) onCommit(n);
  }

  return (
    <div className="row row--toggle">
      <div>
        <div className="row__t">Photos per guest</div>
        <div className="row__sub">Max each person can upload · default 50</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          aria-label="Fewer"
          onClick={() => commit(String((Number(draft) || 0) - 5))}
        >
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={500}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          style={{
            width: 60,
            textAlign: "center",
            padding: "8px 6px",
            border: "1px solid var(--hair-3)",
            borderRadius: "var(--r-ctrl)",
            background: "var(--paper-3)",
            font: "600 15px/1 var(--font-sans)",
            color: "var(--ink)",
          }}
        />
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          aria-label="More"
          onClick={() => commit(String((Number(draft) || 0) + 5))}
        >
          +
        </button>
      </div>
    </div>
  );
}

// Venue design: primary/accent/background colors + a heading font preset.
// Colors commit on blur of the native color input; the font commits on select.
// A tiny live swatch reflects the current palette. Passing the default value
// clears the override server-side is not needed — hosts always send a concrete
// value here, and "default" font maps to no override in venueThemeStyle.
function VenueDesign({
  event,
  onPatch,
}: {
  event: Event;
  onPatch: (p: Partial<Event>) => void;
}) {
  const primary = event.theme_primary ?? THEME_DEFAULTS.primary;
  const accent = event.theme_accent ?? THEME_DEFAULTS.accent;
  const bg = event.theme_bg ?? THEME_DEFAULTS.bg;
  const font = (event.theme_font ?? "default") as ThemeFontKey;

  const swatch = (label: string, value: string, onChange: (v: string) => void) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        flex: 1,
      }}
    >
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label} color`}
        style={{
          width: 44,
          height: 44,
          padding: 0,
          border: "1px solid var(--hair-3)",
          borderRadius: "50%",
          background: "none",
          cursor: "pointer",
        }}
      />
      <span className="microcopy" style={{ margin: 0 }}>
        {label}
      </span>
      <HexInput label={label} value={value} onCommit={onChange} />
    </div>
  );

  return (
    <div className="card card--layouts">
      <div className="kicker kicker--mute">Venue design</div>
      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
        {swatch("Primary", primary, (v) => onPatch({ theme_primary: v }))}
        {swatch("Accent", accent, (v) => onPatch({ theme_accent: v }))}
        {swatch("Background", bg, (v) => onPatch({ theme_bg: v }))}
      </div>
      <label className="label" htmlFor="theme-font" style={{ marginTop: 16 }}>
        Heading font
      </label>
      <div className="field">
        <select
          id="theme-font"
          value={font}
          onChange={(e) =>
            onPatch({ theme_font: e.target.value as ThemeFontKey })
          }
          style={{
            width: "100%",
            padding: "10px 12px",
            border: 0,
            background: "transparent",
            font: "inherit",
            color: "var(--ink)",
          }}
        >
          {(Object.keys(THEME_FONTS) as ThemeFontKey[]).map((k) => (
            <option key={k} value={k}>
              {THEME_FONTS[k].label}
            </option>
          ))}
        </select>
      </div>
      <p className="microcopy" style={{ marginTop: 10 }}>
        Applies to your guest wall. Guests see it the moment you change it.
      </p>
    </div>
  );
}

// Hex-code entry paired with a native color picker. Local text state lets the
// host type a code freely; it commits only when it's a valid #RRGGBB, and it
// re-syncs whenever the picker changes the value from outside.
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
function HexInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
}) {
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  function commit(raw: string) {
    let v = raw.trim();
    if (v && !v.startsWith("#")) v = `#${v}`;
    if (HEX_RE.test(v)) {
      const norm = v.toLowerCase();
      if (norm !== value.toLowerCase()) onCommit(norm);
      setText(norm);
    } else {
      setText(value); // revert invalid entry
    }
  }

  return (
    <input
      type="text"
      value={text}
      spellCheck={false}
      autoCapitalize="none"
      aria-label={`${label} hex code`}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      style={{
        width: 76,
        textAlign: "center",
        fontSize: 12,
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        padding: "4px 6px",
        border: "1px solid var(--hair-3)",
        borderRadius: "var(--r-ctrl)",
        background: "var(--paper-3)",
        color: "var(--ink)",
        textTransform: "lowercase",
      }}
    />
  );
}

// Venue banner: shown to guests at the top of the upload page. Upload flow
// mirrors guest photos — init mints a signed storage URL, the file PUTs
// straight to the wall-covers bucket, then a PATCH pins cover_image_path.
const BANNER_MAX_BYTES = 8_000_000;
const BANNER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function BannerUpload({
  eventId,
  initialUrl,
  hasCover,
  onChanged,
}: {
  eventId: string;
  initialUrl: string | null;
  hasCover: boolean;
  onChanged: (path: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!BANNER_TYPES.has(file.type)) {
      setError("Use a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > BANNER_MAX_BYTES) {
      setError("Max 8 MB — compress the image first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const initRes = await fetch(
        `/api/host/events/${encodeURIComponent(eventId)}/cover/init`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content_type: file.type, bytes: file.size }),
        },
      );
      if (!initRes.ok) throw new Error("init");
      const init = (await initRes.json()) as {
        path: string;
        upload_url: string;
      };
      const put = await fetch(init.upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error("put");
      const patch = await fetch(
        `/api/host/events/${encodeURIComponent(eventId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cover_image_path: init.path }),
        },
      );
      if (!patch.ok) throw new Error("patch");
      setPreview(URL.createObjectURL(file));
      onChanged(init.path);
    } catch {
      setError("Upload failed. Try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/host/events/${encodeURIComponent(eventId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cover_image_path: null }),
        },
      );
      if (!res.ok) throw new Error("patch");
      setPreview(null);
      onChanged(null);
    } catch {
      setError("Couldn't remove it. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ margin: "18px 24px 0" }}>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {preview ? (
        <img
          src={preview}
          alt="Venue banner"
          style={{
            display: "block",
            width: "100%",
            height: 150,
            objectFit: "cover",
            borderRadius: "var(--r-ctrl)",
            border: "1px solid var(--hair)",
          }}
        />
      ) : (
        <div className="host__cover cover__art--01" style={{ margin: 0 }} />
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 8,
        }}
      >
        <button
          type="button"
          className="ulink"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          style={{ background: "none", border: 0, padding: 0 }}
        >
          {busy
            ? "Working…"
            : preview || hasCover
              ? "Replace banner"
              : "Upload a venue banner"}
        </button>
        {preview ? (
          <button
            type="button"
            className="ulink"
            disabled={busy}
            onClick={() => void remove()}
            style={{ background: "none", border: 0, padding: 0 }}
          >
            Remove
          </button>
        ) : null}
      </div>
      <p className="microcopy" style={{ marginTop: 4 }}>
        Guests see this at the top of the &ldquo;Add your photos&rdquo; page.
        JPEG, PNG, or WebP · max 8 MB.
      </p>
      {error ? (
        <p className="microcopy" style={{ color: "#b8443b", marginTop: 4 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

// Small in-place editor for the two host-supplied strings that drive the guest
// wall's header. Kept on the same page because the moment a host lands here
// after approval, "your wall is called <venue>" and "Date to be set" are the
// two things they want to change first.
function EditableDetails({
  eventId,
  coupleDisplay,
  whenText,
  welcomeMessage,
  onSaved,
}: {
  eventId: string;
  coupleDisplay: string;
  whenText: string;
  welcomeMessage: string | null;
  onSaved: (patch: {
    couple_display?: string;
    when_text?: string;
    welcome_message?: string | null;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [couple, setCouple] = useState(coupleDisplay);
  const [when, setWhen] = useState(whenText);
  const [welcome, setWelcome] = useState(welcomeMessage ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initial = useRef({
    couple: coupleDisplay,
    when: whenText,
    welcome: welcomeMessage ?? "",
  });

  if (!open) {
    return (
      <button
        type="button"
        className="row row--toggle"
        style={{ textAlign: "left", background: "transparent", border: 0 }}
        onClick={() => setOpen(true)}
      >
        <div>
          <div className="row__t">Wall details</div>
          <div className="row__sub">Rename the wall or set the date</div>
        </div>
        <span className="cta-row__arrow" style={{ color: "var(--dusk)" }}>
          ✎
        </span>
      </button>
    );
  }

  const dirty =
    couple.trim() !== initial.current.couple ||
    when.trim() !== initial.current.when ||
    welcome.trim() !== initial.current.welcome;

  async function save() {
    setError(null);
    const patch: {
      couple_display?: string;
      when_text?: string;
      welcome_message?: string | null;
    } = {};
    if (couple.trim() && couple.trim() !== initial.current.couple) {
      patch.couple_display = couple.trim();
    }
    if (when.trim() && when.trim() !== initial.current.when) {
      patch.when_text = when.trim();
    }
    if (welcome.trim() !== initial.current.welcome) {
      // Empty string sent to the server signals "clear this" — the PATCH
      // route normalizes to null so guests stop seeing the previous message.
      patch.welcome_message = welcome.trim() ? welcome : "";
    }
    if (Object.keys(patch).length === 0) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/host/events/${encodeURIComponent(eventId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      if (!res.ok) {
        setError("Couldn't save. Try again.");
        setSaving(false);
        return;
      }
      onSaved({
        ...patch,
        // Local optimistic state uses null for empty so the guest wall's
        // render-if-truthy pattern stays consistent with what the server
        // will echo back on the next load.
        welcome_message:
          patch.welcome_message === ""
            ? null
            : patch.welcome_message ?? undefined,
      });
      initial.current = {
        couple: couple.trim(),
        when: when.trim(),
        welcome: welcome.trim(),
      };
      setOpen(false);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="kicker kicker--mute">Wall details</div>
      <label className="label" htmlFor="couple-input" style={{ marginTop: 12 }}>
        Couple / venue name
      </label>
      <div className="field">
        <input
          id="couple-input"
          type="text"
          value={couple}
          maxLength={256}
          onChange={(e) => setCouple(e.target.value)}
        />
      </div>
      <label className="label" htmlFor="when-input" style={{ marginTop: 12 }}>
        Date &amp; kicker line
      </label>
      <div className="field">
        <input
          id="when-input"
          type="text"
          value={when}
          maxLength={256}
          onChange={(e) => setWhen(e.target.value)}
          placeholder="You're invited · 14 June 2026"
        />
      </div>
      <label
        className="label"
        htmlFor="welcome-input"
        style={{ marginTop: 12 }}
      >
        Welcome message <span style={{ color: "#888" }}>(optional)</span>
      </label>
      <div className="field">
        <textarea
          id="welcome-input"
          value={welcome}
          maxLength={2000}
          rows={4}
          onChange={(e) => setWelcome(e.target.value)}
          placeholder="A short note from the couple to their guests."
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
      <p className="microcopy" style={{ marginTop: -4 }}>
        Shown to guests right above the &ldquo;Add your photos&rdquo; button.
        Leave blank to hide.
      </p>
      {error ? (
        <p
          className="microcopy"
          style={{ color: "#b8443b", marginTop: 8 }}
        >
          {error}
        </p>
      ) : null}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button
          type="button"
          className="btn btn--primary"
          disabled={saving || !dirty}
          onClick={save}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={saving}
          onClick={() => {
            setCouple(initial.current.couple);
            setWhen(initial.current.when);
            setWelcome(initial.current.welcome);
            setError(null);
            setOpen(false);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// Streams a ZIP of every approved photo on the event. The button drives a
// direct navigation (rather than fetch → blob) so the browser handles the
// download UI and doesn't pin the whole archive in memory for large weddings.
function DownloadAll({
  eventId,
  eventCode,
}: {
  eventId: string;
  eventCode: string;
}) {
  const [starting, setStarting] = useState(false);

  return (
    <div className="row row--toggle">
      <div>
        <div className="row__t">Download all photos</div>
        <div className="row__sub">
          One ZIP of every approved photo. Safe to run mid-event.
        </div>
      </div>
      <button
        type="button"
        className="btn"
        disabled={starting}
        onClick={() => {
          // Trigger a top-level navigation so the browser's own download
          // manager takes over — no giant Blob held in the tab.
          setStarting(true);
          window.location.href = `/api/host/events/${encodeURIComponent(
            eventId,
          )}/download`;
          // Re-enable after a moment; the navigation is already in flight.
          setTimeout(() => setStarting(false), 4000);
        }}
        aria-label={`Download all photos for ${eventCode}`}
      >
        {starting ? "Preparing…" : "Download"}
      </button>
    </div>
  );
}
