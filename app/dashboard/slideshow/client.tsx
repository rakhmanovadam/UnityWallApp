"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import type { PhotoListItem } from "@/lib/db/photos";
import { renderCoupleDisplay } from "@/lib/render";

const ROTATE_MS = 6000;

export default function SlideshowClient({
  eventId,
  coupleDisplay,
  whenText,
  initialPhotos,
}: {
  eventId: string;
  coupleDisplay: string;
  whenText: string;
  initialPhotos: PhotoListItem[];
}) {
  const [photos, setPhotos] = useState<PhotoListItem[]>(initialPhotos);
  const [idx, setIdx] = useState(0);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    const channel = supabase.channel(`wall:${eventId}`);
    async function pull(photoId: string) {
      try {
        const res = await fetch(
          `/api/photos/${encodeURIComponent(photoId)}/sign?event_id=${encodeURIComponent(eventId)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { item: PhotoListItem };
        setPhotos((prev) => {
          if (prev.some((p) => p.id === data.item.id)) return prev;
          return [data.item, ...prev];
        });
      } catch {}
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
          if (row.status === "approved") void pull(row.id);
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
          if (row.status === "approved") void pull(row.id);
        },
      )
      .subscribe();
    return () => {
      void channel.unsubscribe();
    };
  }, [supabase, eventId]);

  useEffect(() => {
    if (photos.length < 2) return;
    const t = setInterval(
      () => setIdx((i) => (i + 1) % photos.length),
      ROTATE_MS,
    );
    return () => clearInterval(t);
  }, [photos.length]);

  const current = photos[idx];
  const caption = current?.caption ?? "";

  return (
    <section className="screen screen--slide">
      <div className="slide">
        {current ? (
          <div
            className="slide__art"
            style={{
              backgroundImage: `url(${current.thumb_url})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        ) : (
          <div className="slide__art" />
        )}
        <div className="slide__vignette" />
        <div className="slide__shade" />
        <div className="slide__brand">
          <span className="brandmark brandmark--xs" />
          <span>Unitywalls</span>
        </div>
        <div className="slide__title">
          <div className="kicker kicker--dusk">{whenText}</div>
          {/* Render coupleDisplay as React children — not innerHTML — so
              host-supplied strings can't inject script into the slideshow. */}
          <div className="slide__h">{renderCoupleDisplay(coupleDisplay)}</div>
        </div>
        <div className="slide__caption">{caption}</div>
        <div className="slide__progress">
          {photos.slice(0, 3).map((p, i) => (
            <span
              key={p.id}
              className={"progress-bar" + (i === idx % 3 ? " progress-bar--on" : "")}
            />
          ))}
        </div>
        <Link className="slide__exit" href="/dashboard" aria-label="Exit">
          ×
        </Link>
      </div>
    </section>
  );
}
