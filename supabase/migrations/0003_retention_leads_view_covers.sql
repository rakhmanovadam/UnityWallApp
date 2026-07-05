-- UnityWall schema v0003
--
-- Backend-only additions to unblock retention/lifecycle work, the admin
-- master-email table, and the host cover-image upload flow. No behavior
-- change on existing paths — every new column is nullable-or-defaulted.

-- ---------- events: retention window ----------
-- retention_days is the host-visible knob (60 by default per the plan).
-- delete_after is populated by a BEFORE trigger rather than a generated
-- column because `timestamptz + interval` is not IMMUTABLE in Postgres
-- (it depends on session tz), and generated stored columns require
-- IMMUTABLE expressions. The trigger fires on inserts and on updates to
-- ends_at / retention_days, so the purge cron and the 14d/3d download-
-- reminder emails can just index by `delete_after < now()` without
-- recomputing anywhere.
alter table public.events
  add column if not exists retention_days int not null default 60;

alter table public.events
  add column if not exists delete_after timestamptz;

create or replace function public.compute_event_delete_after()
returns trigger language plpgsql as $$
begin
  new.delete_after := coalesce(new.ends_at, new.created_at)
                      + make_interval(days => new.retention_days);
  return new;
end $$;

drop trigger if exists events_set_delete_after on public.events;
create trigger events_set_delete_after
  before insert or update of ends_at, retention_days
  on public.events
  for each row execute function public.compute_event_delete_after();

-- Backfill anything that predates the trigger (touch each row so the
-- trigger fires — the no-op update to retention_days is the smallest
-- viable nudge).
update public.events
   set retention_days = retention_days
 where delete_after is null;

create index if not exists events_delete_after_idx on public.events(delete_after);

-- ---------- leads: person_type + conversion tracking ----------
-- person_type distinguishes a guest who dropped an email to upload photos
-- from an approved venue host. converted / converted_at drive the "closed
-- as customer" column in the admin master email table.
alter table public.leads
  add column if not exists person_type text not null default 'guest'
    check (person_type in ('guest','venue_host'));

alter table public.leads
  add column if not exists converted boolean not null default false;

alter table public.leads
  add column if not exists converted_at timestamptz;

create index if not exists leads_person_type_idx on public.leads(person_type);
create index if not exists leads_converted_idx on public.leads(converted);

-- ---------- admin master-email view ----------
-- Single row per unique email across leads / guests / approved-photo counts.
-- Aggregates a guest across events (email is a natural key across events),
-- picks the highest lead temperature seen for that email (never downgrades),
-- and reports the count of that email's approved photos.
--
-- security_invoker = true so the caller's RLS applies. Non-admins see zero
-- rows because guests / leads / photos are already admin-gated.

drop view if exists public.admin_master_emails;

create view public.admin_master_emails
with (security_invoker = true) as
with lead_agg as (
  select
    lower(l.email::text) as email_lower,
    max(l.name) as name,
    max(
      case l.source
        when 'hot' then 3
        when 'request' then 3
        when 'warm' then 2
        else 1
      end
    ) as temp_rank,
    bool_or(l.converted) as converted,
    max(l.converted_at) as converted_at,
    max(l.person_type) as person_type,
    min(l.created_at) as first_seen
  from public.leads l
  where l.email is not null
  group by lower(l.email::text)
),
guest_agg as (
  select
    lower(g.email::text) as email_lower,
    max(g.display_name) as display_name,
    min(g.created_at) as first_joined,
    count(*) filter (where g.verified_at is not null) as verified_events
  from public.guests g
  group by lower(g.email::text)
),
photo_counts as (
  select
    lower(g.email::text) as email_lower,
    count(*)::int as photos_uploaded
  from public.photos p
  join public.guests g on g.id = p.guest_id
  where p.status = 'approved'
  group by lower(g.email::text)
),
all_emails as (
  select email_lower from lead_agg
  union
  select email_lower from guest_agg
  union
  select email_lower from photo_counts
)
select
  ae.email_lower as email,
  coalesce(l.name, gu.display_name) as name,
  case
    when l.temp_rank = 3 then 'hot'
    when l.temp_rank = 2 then 'warm'
    else 'cold'
  end as lead_temperature,
  coalesce(l.person_type, 'guest') as person_type,
  coalesce(l.converted, false) as converted,
  l.converted_at,
  coalesce(l.first_seen, gu.first_joined) as joined_at,
  coalesce(pc.photos_uploaded, 0) as photos_uploaded,
  coalesce(gu.verified_events, 0) as verified_events
from all_emails ae
left join lead_agg l on l.email_lower = ae.email_lower
left join guest_agg gu on gu.email_lower = ae.email_lower
left join photo_counts pc on pc.email_lower = ae.email_lower
order by joined_at desc nulls last;

-- ---------- wall covers bucket ----------
-- Public read (guests hit /storage/v1/object/public/wall-covers/...) so the
-- landing page doesn't need a signed URL per pageview. Writes go through
-- signed upload URLs minted by the API, so unauthorized writes are still
-- blocked. Path convention: <event_id>/<uuid>.<ext>.
insert into storage.buckets (id, name, public)
values ('wall-covers', 'wall-covers', true)
on conflict (id) do nothing;
