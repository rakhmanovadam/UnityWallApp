-- Raise the default per-guest upload cap from 30 to 40 and lift existing
-- events that are still sitting on the old default. Hosts can now override
-- this per event from the dashboard (max_uploads_per_guest is exposed in the
-- host PATCH schema), so we only touch rows that never diverged from 30.

alter table public.events
  alter column max_uploads_per_guest set default 40;

update public.events
  set max_uploads_per_guest = 40
  where max_uploads_per_guest = 30;
