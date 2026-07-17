-- Late-activity host alerts.
--
-- Guests sometimes upload weeks after the event, unaware a wall lives only
-- ~60 days. Hosts have usually stopped checking by then. This column lets the
-- retention cron alert a host when fresh photos land on a wall that is already
-- older than 30 days, and only re-alert when NEW photos arrive after the last
-- notice (stamped to now on each send).

alter table public.events
  add column if not exists late_activity_notified_at timestamptz;
