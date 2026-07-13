-- Raise the default per-guest upload cap from 40 to 50. Lift existing events
-- still sitting on the previous default (40); hosts who set a custom value keep
-- it. The cap stays host-editable from the venue dashboard.

alter table public.events
  alter column max_uploads_per_guest set default 50;

update public.events
  set max_uploads_per_guest = 50
  where max_uploads_per_guest = 40;
