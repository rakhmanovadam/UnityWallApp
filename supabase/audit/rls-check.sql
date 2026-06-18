-- Run in the Supabase SQL editor to confirm RLS is enabled on every
-- public-schema table the app touches. All seven rows must show t (true).
--
-- Pass criteria (acceptance test #9): the per-table policies enforce
-- "live events + approved photos for anon; everything else denies."
-- This script just verifies the toggle; the policy contents are in
-- 0001_init.sql.

select
  schemaname,
  tablename,
  rowsecurity as rls_enabled,
  (
    select count(*)
    from pg_policies p
    where p.schemaname = t.schemaname and p.tablename = t.tablename
  ) as policy_count
from pg_tables t
where schemaname = 'public'
  and tablename in (
    'events',
    'guests',
    'photos',
    'otp_codes',
    'leads',
    'applications',
    'audit_log'
  )
order by tablename;
