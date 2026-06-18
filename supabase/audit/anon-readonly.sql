-- Acceptance test #9: under the anon role, only live events + approved
-- photos are visible; otp_codes, guests, leads, applications, audit_log
-- all return zero rows.
--
-- Run in the Supabase SQL editor. Wrap each block with set role anon /
-- reset role so you don't change your editor session permanently.

set role anon;

-- Should return only events.status = 'live'. Drafts/archived should not show.
select id, code, status
from public.events
order by code;

-- Should return only photos with status='approved' from events with status='live'.
select id, event_id, status
from public.photos
order by uploaded_at desc
limit 20;

-- Each of the following SHOULD return zero rows. If any returns rows, the
-- corresponding policy needs to be tightened.
select count(*) as guests_visible from public.guests;
select count(*) as otp_visible from public.otp_codes;
select count(*) as leads_visible from public.leads;
select count(*) as applications_visible from public.applications;
select count(*) as audit_visible from public.audit_log;

reset role;
