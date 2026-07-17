"use client";

import { useEffect, useState } from "react";

// Live "this room expires in X days Y hours" pill. delete_after is the wall's
// purge timestamp (set server-side from ends_at/created_at + retention_days).
// Guests often don't know a wall only lives ~60 days, so we surface it here.
function format(deleteAfter: string, nowMs: number): string | null {
  const end = new Date(deleteAfter).getTime();
  if (!Number.isFinite(end)) return null;
  let ms = end - nowMs;
  if (ms <= 0) return "This room is closing";
  const days = Math.floor(ms / 86_400_000);
  ms -= days * 86_400_000;
  const hours = Math.floor(ms / 3_600_000);
  if (days >= 1) {
    return `This room expires in ${days} day${days === 1 ? "" : "s"} ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  ms -= hours * 3_600_000;
  const mins = Math.floor(ms / 60_000);
  return `This room expires in ${hours} hour${hours === 1 ? "" : "s"} ${mins} min`;
}

export default function ExpiryCountdown({
  deleteAfter,
  className,
}: {
  deleteAfter: string | null;
  className?: string;
}) {
  // Recompute each minute. Start null to avoid a hydration mismatch — the
  // server render can't know the client clock — then fill in after mount.
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!deleteAfter) return;
    const tick = () => setLabel(format(deleteAfter, Date.now()));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [deleteAfter]);

  if (!deleteAfter || !label) return null;

  return (
    <span className={"expiry-pill" + (className ? " " + className : "")}>
      <span className="expiry-pill__dot" aria-hidden="true" />
      {label}
    </span>
  );
}
