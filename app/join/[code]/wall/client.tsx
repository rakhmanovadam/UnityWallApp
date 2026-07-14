"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import type { PhotoListItem } from "@/lib/db/photos";
import BackLink from "@/app/back-link";

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

  const loadingRef = useRef(false);
  const loadMore = useCallback(async () => {
    if (loadingRef.current || !cursorRef.current) return;
    loadingRef.current = true;
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
      // ignore — sentinel will retrigger on the next scroll
    } finally {
      loadingRef.current = false;
    }
  }, [eventId]);

  return (
    <section className="screen screen--wall">
      <BackLink href={`/join/${encodeURIComponent(code)}/upload`} />
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

function aspectOf(p: PhotoListItem) {
  return p.width && p.height ? p.width / p.height : 1;
}

type JustifiedRow = {
  key: string;
  height: number;
  hero: boolean;
  items: Array<{ photo: PhotoListItem; width: number }>;
};

const ROW_GAP = 5;
const HERO_EVERY = 9;

// Flickr-style justified rows: pack photos left-to-right at natural aspect
// until the row overflows at the target height, then scale the row so it
// fills the container exactly. Every HERO_EVERY-th photo starts a taller
// "hero band" (2x target) that packs and justifies like any other row, so
// the accent never leaves empty space and nothing is cropped.
function packJustified(
  photos: PhotoListItem[],
  containerWidth: number,
): JustifiedRow[] {
  if (containerWidth <= 0) return [];
  const base = containerWidth >= 900 ? 220 : 150;
  const rows: JustifiedRow[] = [];
  let buf: PhotoListItem[] = [];
  let sum = 0;
  let rowTarget = base;
  let rowHero = false;

  function flush(justify: boolean) {
    if (buf.length === 0) return;
    const gaps = ROW_GAP * (buf.length - 1);
    const h = justify
      ? Math.min((containerWidth - gaps) / sum, rowTarget * 1.6)
      : rowTarget;
    rows.push({
      key: buf[0].id,
      height: Math.round(h),
      hero: rowHero,
      items: buf.map((p) => ({ photo: p, width: aspectOf(p) * h })),
    });
    buf = [];
    sum = 0;
    rowTarget = base;
    rowHero = false;
  }

  photos.forEach((p, i) => {
    if (i % HERO_EVERY === 0) {
      flush(true);
      rowTarget = base * 2;
      rowHero = true;
    }
    buf.push(p);
    sum += aspectOf(p);
    if (sum * rowTarget + ROW_GAP * (buf.length - 1) >= containerWidth) {
      flush(true);
    }
  });
  flush(false); // last row keeps target height, left-aligned
  return rows;
}

function JustifiedGrid({
  photos,
  sentinel,
}: {
  photos: PhotoListItem[];
  sentinel: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = useMemo(() => packJustified(photos, width), [photos, width]);

  return (
    <div
      id="wall-grid"
      ref={wrapRef}
      className="wall__grid wall__grid--justified"
      data-layout="grid"
    >
      {rows.map((row, ri) => (
        <div
          key={row.key}
          className={"wall__row" + (row.hero ? " wall__row--hero" : "")}
          style={{ height: row.height, animationDelay: `${(ri % 12) * 40}ms` }}
        >
          {row.items.map(({ photo, width: w }) => (
            <div
              key={photo.id}
              className="wall__tile wall__tile--photo"
              style={{ width: w }}
            >
              <img
                src={photo.thumb_url}
                alt={photo.caption ?? ""}
                loading="lazy"
                decoding="async"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </div>
          ))}
        </div>
      ))}
      {sentinel}
    </div>
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
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMore();
      },
      { rootMargin: "600px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [onLoadMore, layout]);

  const sentinel = (
    <div ref={sentinelRef} className="wall__sentinel" aria-hidden="true" />
  );

  if (layout === "feature") {
    return (
      <div
        id="wall-grid"
        className="wall__grid wall__grid--feature"
        data-layout="feature"
      >
        {photos.map((p, i) => (
          <figure
            key={p.id}
            className="wall__tile wall__tile--feature"
            style={{ animationDelay: `${(i % 8) * 60}ms` }}
          >
            <img
              className="wall__photo"
              src={p.thumb_url}
              alt={p.caption ?? ""}
              loading="lazy"
              decoding="async"
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
        {sentinel}
      </div>
    );
  }
  if (layout === "grid") {
    return <JustifiedGrid photos={photos} sentinel={sentinel} />;
  }
  return (
    <div
      id="wall-grid"
      className="wall__grid wall__grid--mosaic"
      data-layout="mosaic"
    >
      <div className="wall__masonry">
        {photos.map((p, i) => {
          const hasDims = Boolean(p.width && p.height);
          return (
            <div
              key={p.id}
              className="wall__tile wall__tile--photo"
              style={{
                aspectRatio: hasDims ? `${p.width} / ${p.height}` : undefined,
                animationDelay: `${(i % 20) * 50}ms`,
              }}
            >
              <img
                src={p.thumb_url}
                alt={p.caption ?? ""}
                loading="lazy"
                decoding="async"
                style={
                  hasDims
                    ? { width: "100%", height: "100%", objectFit: "cover" }
                    : { width: "100%", height: "auto", display: "block" }
                }
              />
            </div>
          );
        })}
      </div>
      {sentinel}
    </div>
  );
}
