"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import type { PhotoListItem } from "@/lib/db/photos";

type Layout = "mosaic" | "feature" | "grid";

const LAYOUT_KEY = "uw:wall_layout";

function readLayout(): Layout {
  if (typeof window === "undefined") return "mosaic";
  const v = window.localStorage.getItem(LAYOUT_KEY);
  return v === "feature" || v === "grid" ? v : "mosaic";
}

function dedupe(items: PhotoListItem[]) {
  const seen = new Set<string>();
  const out: PhotoListItem[] = [];
  for (const p of items) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

export default function WallClient({
  eventId,
  code,
  coupleDisplay,
  initialPhotos,
  initialCursor,
}: {
  eventId: string;
  code: string;
  coupleDisplay: string;
  initialPhotos: PhotoListItem[];
  initialCursor: string | null;
}) {
  const [layout, setLayout] = useState<Layout>("mosaic");
  const [photos, setPhotos] = useState<PhotoListItem[]>(initialPhotos);
  const [hereCount, setHereCount] = useState<number>(1);
  const supabase = useMemo(() => createClient(), []);
  const cursorRef = useRef(initialCursor);

  useEffect(() => {
    setLayout(readLayout());
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LAYOUT_KEY, layout);
  }, [layout]);

  // Subscribe to photos INSERT / UPDATE filtered by event. RLS guarantees
  // we only get rows with status='approved' and the event being live.
  useEffect(() => {
    const channel = supabase.channel(`wall:${eventId}`);

    async function pullPhoto(photoId: string) {
      try {
        const res = await fetch(
          `/api/photos/${encodeURIComponent(photoId)}/sign?event_id=${encodeURIComponent(eventId)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { item: PhotoListItem };
        setPhotos((prev) => dedupe([data.item, ...prev]));
      } catch {
        // network — try again on the next event.
      }
    }

    channel
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "photos",
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          const row = payload.new as { id: string; status: string };
          if (row.status === "approved") void pullPhoto(row.id);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "photos",
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          const row = payload.new as { id: string; status: string };
          if (row.status === "approved") void pullPhoto(row.id);
        },
      )
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setHereCount(Math.max(1, Object.keys(state).length));
      });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ ts: Date.now() });
      }
    });

    return () => {
      void channel.unsubscribe();
    };
  }, [supabase, eventId]);

  async function loadMore() {
    if (!cursorRef.current) return;
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/photos?cursor=${encodeURIComponent(cursorRef.current)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        items: PhotoListItem[];
        next_cursor: string | null;
      };
      cursorRef.current = data.next_cursor;
      setPhotos((prev) => dedupe([...prev, ...data.items]));
    } catch {
      // ignore
    }
  }

  return (
    <section className="screen screen--wall">
      <header className="wall__head">
        <div>
          <span className="kicker kicker--dusk" id="wall-couple-kicker">
            {coupleDisplay}
          </span>
          <div className="wall__title">The Wall</div>
        </div>
        <span className="badge badge--here">
          <span className="pulse-dot">
            <span />
          </span>
          <span id="here-count">{hereCount}</span> here now
        </span>
      </header>

      <div className="wall__layouts" role="tablist" aria-label="Gallery layout">
        {(["mosaic", "feature", "grid"] as Layout[]).map((opt) => (
          <button
            key={opt}
            type="button"
            className={"layout" + (layout === opt ? " layout--on" : "")}
            data-layout={opt}
            role="tab"
            aria-selected={layout === opt}
            onClick={() => setLayout(opt)}
          >
            {opt[0].toUpperCase() + opt.slice(1)}
          </button>
        ))}
      </div>

      <Grid layout={layout} photos={photos} onLoadMore={loadMore} />

      <Link
        href={`/join/${encodeURIComponent(code)}/upload`}
        className="fab"
        aria-label="Add photos"
      >
        +
      </Link>
    </section>
  );
}

function Grid({
  layout,
  photos,
  onLoadMore,
}: {
  layout: Layout;
  photos: PhotoListItem[];
  onLoadMore: () => void;
}) {
  // Reserve scroll-triggered loadMore for a future pass; keep the bottom
  // anchor link for now so layouts render cleanly with what we have.
  void onLoadMore;
  if (layout === "feature") {
    return (
      <div
        id="wall-grid"
        className="wall__grid wall__grid--feature"
        data-layout="feature"
      >
        {photos.slice(0, 8).map((p, i) => (
          <figure
            key={p.id}
            className="wall__tile wall__tile--feature"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <img
              className="wall__photo"
              src={p.thumb_url}
              alt={p.caption ?? ""}
              style={{
                width: "100%",
                height: "auto",
                display: "block",
                borderRadius: 2,
                border: "1px solid var(--hair-2)",
              }}
            />
            <figcaption className="wall__cap">
              <span className="wall__cap-title">{p.caption ?? ""}</span>
              <span className="wall__cap-meta">
                {new Date(p.uploaded_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    );
  }
  if (layout === "grid") {
    return (
      <div
        id="wall-grid"
        className="wall__grid wall__grid--grid"
        data-layout="grid"
      >
        {photos.slice(0, 14).map((p, i) => (
          <div
            key={p.id}
            className={
              "wall__tile wall__tile--photo" +
              (i === 0 || i === 6 ? " wall__tile--big" : "")
            }
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <img
              src={p.thumb_url}
              alt={p.caption ?? ""}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div
      id="wall-grid"
      className="wall__grid wall__grid--mosaic"
      data-layout="mosaic"
    >
      {photos.map((p, i) => (
        <div
          key={p.id}
          className="wall__tile wall__tile--photo"
          style={{
            aspectRatio:
              p.width && p.height ? `${p.width} / ${p.height}` : undefined,
            height: p.width && p.height ? undefined : 120 + ((i * 37) % 110),
            animationDelay: `${i * 50}ms`,
          }}
        >
          <img
            src={p.thumb_url}
            alt={p.caption ?? ""}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      ))}
    </div>
  );
}
