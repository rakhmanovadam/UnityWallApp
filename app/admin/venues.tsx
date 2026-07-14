"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type VenueSummary = {
  id: string;
  code: string;
  couple_display: string;
  when_text: string;
  status: "draft" | "live" | "archived";
  host_email: string | null;
  cover_url: string | null;
  photos_total: number;
  photos_pending: number;
  photos_approved: number;
};

type VenuePhoto = {
  id: string;
  thumb_url: string | null;
  status: string;
  caption: string | null;
  uploaded_at: string;
};

type VenueDetail = {
  id: string;
  code: string;
  couple_display: string;
  when_text: string;
  status: string;
  wall_layout: string;
  allow_uploads: boolean;
  require_moderation: boolean;
  max_uploads_per_guest: number;
  welcome_message: string | null;
  photos: VenuePhoto[];
};

// Admin venue oversight: list every wall, drill into any one to review/approve
// photos and edit event settings with full access (including archive).
export default function AdminVenues() {
  const [venues, setVenues] = useState<VenueSummary[] | null>(null);
  const [err, setErr] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/venues");
      if (!res.ok) {
        setErr(true);
        return;
      }
      const data = (await res.json()) as { items: VenueSummary[] };
      setVenues(data.items);
    } catch {
      setErr(true);
    }
  }, []);

  // Delete straight from the list — no need to open the wall first. Guarded by
  // a typed-code prompt so a mis-click can't wipe a wall. Irreversible.
  async function deleteVenue(v: VenueSummary) {
    const typed = window.prompt(
      `Permanently delete "${v.couple_display}"?\n\nThis removes the wall, all ${v.photos_total} photos, guests and codes — forever. Collected lead emails are kept.\n\nType the wall code ${v.code} to confirm:`,
    );
    if (typed == null) return; // cancelled
    if (typed.trim().toUpperCase() !== v.code.toUpperCase()) {
      window.alert("Code didn't match — nothing deleted.");
      return;
    }
    setDeletingId(v.id);
    try {
      const res = await fetch(`/api/admin/venues/${encodeURIComponent(v.id)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setVenues((prev) => (prev ? prev.filter((x) => x.id !== v.id) : prev));
        // Re-run the /admin server component so the control-room tiles
        // (Venues count, conversion) reflect the deletion immediately.
        router.refresh();
      } else {
        window.alert("Couldn't delete the wall. Try again.");
      }
    } catch {
      window.alert("Network error deleting the wall.");
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  if (err) {
    return (
      <div className="info">
        <div className="info__body">Couldn&apos;t load venues. Refresh.</div>
      </div>
    );
  }
  if (!venues) {
    return (
      <div className="info">
        <div className="info__body">Loading venues…</div>
      </div>
    );
  }
  if (venues.length === 0) {
    return (
      <div className="info">
        <div className="info__head">
          <span className="dot dot--dusk" />
          No venues yet
        </div>
      </div>
    );
  }

  if (openId) {
    return (
      <VenueDetailView
        id={openId}
        onBack={() => {
          setOpenId(null);
          void load();
        }}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {venues.map((v) => (
        <div
          key={v.id}
          className="appcard"
          style={{ display: "flex", gap: 12, alignItems: "center" }}
        >
          <div
            role="button"
            tabIndex={0}
            onClick={() => setOpenId(v.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpenId(v.id);
              }
            }}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flex: 1,
              minWidth: 0,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span
              style={{
                width: 52,
                height: 52,
                flexShrink: 0,
                borderRadius: 8,
                background: v.cover_url
                  ? `center/cover url(${JSON.stringify(v.cover_url)})`
                  : "var(--paper-2)",
                border: "1px solid var(--hair-3)",
              }}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="appcard__t">
                {v.couple_display}{" "}
                <span className="adminlist__tag" style={{ textTransform: "capitalize" }}>
                  {v.status}
                </span>
              </div>
              <div className="appcard__sub">
                {v.code} · {v.host_email ?? "no host"} · {v.photos_approved}/
                {v.photos_total} live
                {v.photos_pending > 0 ? ` · ${v.photos_pending} pending` : ""}
              </div>
            </div>
            <span style={{ color: "var(--dusk)" }}>→</span>
          </div>
          <button
            type="button"
            onClick={() => void deleteVenue(v)}
            disabled={deletingId === v.id}
            title="Permanently delete this wall"
            aria-label={`Delete ${v.couple_display}`}
            style={{
              flexShrink: 0,
              padding: "6px 10px",
              fontSize: 13,
              borderRadius: 8,
              border: "1px solid rgba(184,68,59,.4)",
              background: "rgba(184,68,59,.06)",
              color: "#b8443b",
              cursor: "pointer",
            }}
          >
            {deletingId === v.id ? "Deleting…" : "Delete"}
          </button>
        </div>
      ))}
    </div>
  );
}

function VenueDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const [detail, setDetail] = useState<VenueDetail | null>(null);
  const [err, setErr] = useState(false);
  const [busyPhoto, setBusyPhoto] = useState<string | null>(null);
  const [savingField, setSavingField] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/venues/${encodeURIComponent(id)}`);
      if (!res.ok) {
        setErr(true);
        return;
      }
      setDetail((await res.json()) as VenueDetail);
    } catch {
      setErr(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function moderate(photoId: string, status: "approved" | "rejected") {
    setBusyPhoto(photoId);
    try {
      const res = await fetch(`/api/admin/photos/${encodeURIComponent(photoId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setDetail((d) =>
          d
            ? {
                ...d,
                photos: d.photos.map((p) =>
                  p.id === photoId ? { ...p, status } : p,
                ),
              }
            : d,
        );
      }
    } finally {
      setBusyPhoto(null);
    }
  }

  async function patchEvent(patch: Record<string, unknown>) {
    setSavingField(true);
    setDetail((d) => (d ? { ...d, ...patch } : d));
    try {
      await fetch(`/api/admin/venues/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } finally {
      setSavingField(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        className="ulink"
        onClick={onBack}
        style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }}
      >
        ← All venues
      </button>

      {err ? (
        <div className="info" style={{ marginTop: 12 }}>
          <div className="info__body">Couldn&apos;t load this venue.</div>
        </div>
      ) : !detail ? (
        <div className="info" style={{ marginTop: 12 }}>
          <div className="info__body">Loading…</div>
        </div>
      ) : (
        <>
          <div className="wall__title" style={{ marginTop: 12 }}>
            {detail.couple_display}
          </div>
          <div className="appcard__sub" style={{ marginBottom: 12 }}>
            {detail.code} · {detail.when_text}
          </div>

          {/* Full-access settings */}
          <div className="card card--layouts" style={{ marginBottom: 16 }}>
            <div className="kicker kicker--mute">
              Settings {savingField ? "· saving…" : ""}
            </div>
            <label className="label" htmlFor="v-status" style={{ marginTop: 12 }}>
              Status
            </label>
            <div className="field">
              <select
                id="v-status"
                value={detail.status}
                onChange={(e) => patchEvent({ status: e.target.value })}
                style={{ width: "100%", padding: "10px 12px", border: 0, background: "transparent", font: "inherit" }}
              >
                <option value="draft">Draft</option>
                <option value="live">Live</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div className="row row--toggle">
              <div className="row__t">Uploads open</div>
              <button
                type="button"
                className="toggle"
                data-on={detail.allow_uploads ? "true" : "false"}
                aria-pressed={detail.allow_uploads}
                onClick={() => patchEvent({ allow_uploads: !detail.allow_uploads })}
              >
                <span />
              </button>
            </div>
            <div className="row row--toggle">
              <div className="row__t">Require moderation</div>
              <button
                type="button"
                className="toggle"
                data-on={detail.require_moderation ? "true" : "false"}
                aria-pressed={detail.require_moderation}
                onClick={() =>
                  patchEvent({ require_moderation: !detail.require_moderation })
                }
              >
                <span />
              </button>
            </div>
            <div className="row row--toggle">
              <div className="row__t">Photos per guest</div>
              <input
                type="number"
                min={1}
                max={500}
                defaultValue={detail.max_uploads_per_guest}
                onBlur={(e) => {
                  const n = Math.max(1, Math.min(500, Math.round(Number(e.target.value) || 0)));
                  if (n !== detail.max_uploads_per_guest) patchEvent({ max_uploads_per_guest: n });
                }}
                style={{
                  width: 64,
                  textAlign: "center",
                  padding: "8px 6px",
                  border: "1px solid var(--hair-3)",
                  borderRadius: "var(--r-ctrl)",
                  background: "var(--paper-3)",
                }}
              />
            </div>
          </div>

          {/* Photo review */}
          <div className="section-label">
            Photos ({detail.photos.length})
          </div>
          {detail.photos.length === 0 ? (
            <div className="info">
              <div className="info__body">No photos on this wall.</div>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
                gap: 8,
              }}
            >
              {detail.photos.map((p) => (
                <div key={p.id} style={{ position: "relative" }}>
                  <div
                    style={{
                      aspectRatio: "1",
                      borderRadius: 6,
                      background: p.thumb_url
                        ? `center/cover url(${JSON.stringify(p.thumb_url)})`
                        : "var(--paper-2)",
                      border: "1px solid var(--hair-3)",
                      opacity: p.status === "rejected" ? 0.4 : 1,
                    }}
                  />
                  <span
                    className="adminlist__tag"
                    style={{
                      position: "absolute",
                      top: 4,
                      left: 4,
                      fontSize: 9,
                      textTransform: "capitalize",
                      background:
                        p.status === "approved"
                          ? "rgba(58,86,118,.9)"
                          : p.status === "pending"
                            ? "rgba(194,138,62,.92)"
                            : "rgba(120,120,120,.9)",
                      color: "#fff",
                    }}
                  >
                    {p.status}
                  </span>
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                    <button
                      type="button"
                      onClick={() => moderate(p.id, "approved")}
                      disabled={busyPhoto === p.id || p.status === "approved"}
                      title="Approve"
                      style={miniBtn(p.status === "approved")}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      onClick={() => moderate(p.id, "rejected")}
                      disabled={busyPhoto === p.id || p.status === "rejected"}
                      title="Reject"
                      style={miniBtn(p.status === "rejected")}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function miniBtn(active: boolean) {
  return {
    flex: 1,
    padding: "4px 0",
    fontSize: 12,
    borderRadius: 4,
    border: "1px solid var(--hair-3)",
    background: active ? "var(--dusk)" : "var(--paper-3)",
    color: active ? "#fff" : "var(--ink)",
    cursor: "pointer",
  } as const;
}
