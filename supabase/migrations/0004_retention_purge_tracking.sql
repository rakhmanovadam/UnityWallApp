-- UnityWall schema v0004
--
-- Runtime bookkeeping for the retention lifecycle cron (app/api/cron/retention).
-- 0003 added `events.delete_after` (when a wall's photos expire); this migration
-- adds the columns the daily job needs to (a) send each download reminder at most
-- once and (b) never purge the same wall twice. All nullable, no behavior change
-- on existing paths.

alter table public.events
  add column if not exists reminder_14d_sent_at timestamptz;

alter table public.events
  add column if not exists reminder_3d_sent_at timestamptz;

-- purged_at is stamped when the cron deletes a wall's photos + storage objects.
-- The purge query filters on `purged_at is null` so a re-run is a cheap no-op.
alter table public.events
  add column if not exists purged_at timestamptz;

-- The purge sweep and both reminder sweeps all range-scan delete_after; 0003
-- already indexes it. This partial index keeps the "not yet purged, past due"
-- lookup tight even once most events carry a delete_after in the past.
create index if not exists events_purge_pending_idx
  on public.events(delete_after)
  where purged_at is null;
