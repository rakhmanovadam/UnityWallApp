"use client";

import { useCallback, useEffect, useState } from "react";

type PendingItem = {
  id: string;
  caption: string | null;
  uploaded_at: string;
  thumb_url: string | null;
};

type Decision = "approved" | "rejected";

export default function ModerationClient({ eventId }: { eventId: string }) {
  const [items, setItems] = useState<PendingItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // per-photo state so multiple simultaneous decisions don't share a spinner
  const [busy, setBusy] = useState<Record<string, Decision | null>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `/api/host/events/${encodeURIComponent(eventId)}/moderation`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setError("Couldn't load the queue. Refresh in a moment.");
        return;
      }
      const data = (await res.json()) as { items: PendingItem[] };
      setItems(data.items);
    } catch {
      setError("Network error. Refresh in a moment.");
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(photoId: string, status: Decision) {
    setBusy((b) => ({ ...b, [photoId]: status }));
    try {
      const res = await fetch(
        `/api/host/photos/${encodeURIComponent(photoId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      if (!res.ok) {
        setError("That didn't save. Try again.");
        setBusy((b) => ({ ...b, [photoId]: null }));
        return;
      }
      // Drop the row from the queue on success — approved photos are now on
      // the wall; rejected photos stay in storage but are hidden.
      setItems((prev) => (prev ? prev.filter((p) => p.id !== photoId) : prev));
    } catch {
      setError("Network error. Try again.");
      setBusy((b) => ({ ...b, [photoId]: null }));
    }
  }

  if (items === null && !error) {
    return <p className="microcopy">Loading queue…</p>;
  }

  if (error) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <p className="microcopy" style={{ color: "#b8443b" }}>
          {error}
        </p>
        <button className="btn" type="button" onClick={load}>
          Retry
        </button>
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="card" style={{ padding: 20, textAlign: "center" }}>
        <div className="kicker kicker--mute">All clear</div>
        <p className="lede" style={{ marginTop: 6 }}>
          Nothing waiting on your call.
        </p>
      </div>
    );
  }

  return (
    <div
      className="moderation-grid"
      style={{
        display: "grid",
        gap: 12,
        gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
        marginTop: 12,
      }}
    >
      {items.map((p) => {
        const rowBusy = busy[p.id];
        return (
          <div
            key={p.id}
            className="card"
            style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8 }}
          >
            <div
              style={{
                aspectRatio: "1 / 1",
                borderRadius: 8,
                overflow: "hidden",
                background: "#eee",
              }}
            >
              {p.thumb_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.thumb_url}
                  alt={p.caption ?? "Pending photo"}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : null}
            </div>
            {p.caption ? (
              <div className="microcopy" style={{ minHeight: 16 }}>
                {p.caption}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className="btn btn--primary"
                style={{ flex: 1, padding: "8px 10px", fontSize: 14 }}
                disabled={rowBusy != null}
                onClick={() => decide(p.id, "approved")}
              >
                {rowBusy === "approved" ? "…" : "Approve"}
              </button>
              <button
                type="button"
                className="btn"
                style={{ flex: 1, padding: "8px 10px", fontSize: 14 }}
                disabled={rowBusy != null}
                onClick={() => decide(p.id, "rejected")}
              >
                {rowBusy === "rejected" ? "…" : "Hide"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
