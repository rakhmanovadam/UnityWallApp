-- UnityWall schema v0005
--
-- 1. Conversion becomes a manual admin action: "converted" now means "this
--    person actually bought from UnityWall", checked by hand in the admin
--    console. The approve flow no longer auto-flips it (code change ships
--    with this migration) — no schema change needed for that, but the view
--    below is the surface the checkbox reads/writes through leads.converted.
-- 2. admin_master_emails gains marketing_opt_in so the console can show
--    whether each collected email opted in to marketing.

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
    count(*) filter (where g.verified_at is not null) as verified_events,
    bool_or(g.marketing_opt_in) as marketing_opt_in
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
  coalesce(gu.marketing_opt_in, false) as marketing_opt_in,
  coalesce(l.first_seen, gu.first_joined) as joined_at,
  coalesce(pc.photos_uploaded, 0) as photos_uploaded,
  coalesce(gu.verified_events, 0) as verified_events
from all_emails ae
left join lead_agg l on l.email_lower = ae.email_lower
left join guest_agg gu on gu.email_lower = ae.email_lower
left join photo_counts pc on pc.email_lower = ae.email_lower
order by joined_at desc nulls last;
