-- UnityWall schema v0001
-- Tables, RLS, indexes, seed.

create extension if not exists citext;
create extension if not exists pgcrypto;

-- ---------- helper functions ----------

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

-- Used in photos RLS to avoid recursive policy lookups on events.
create or replace function public.event_is_live(eid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.events where id = eid and status = 'live');
$$;

-- ---------- tables ----------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  couple_display text not null,
  couple_html text not null,
  when_text text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  host_user_id uuid references auth.users on delete set null,
  status text not null default 'draft' check (status in ('draft','live','archived')),
  wall_layout text not null default 'mosaic',
  allow_uploads boolean not null default true,
  require_moderation boolean not null default false,
  max_uploads_per_guest int not null default 30,
  created_at timestamptz not null default now()
);

create table public.guests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  email citext not null,
  display_name text,
  verified_at timestamptz,
  marketing_opt_in boolean not null default false,
  consent_timestamp timestamptz,
  consent_text_version text,
  created_at timestamptz not null default now(),
  unique(event_id, email)
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  guest_id uuid references public.guests on delete set null,
  storage_path text not null,
  thumb_path text,
  caption text,
  width int,
  height int,
  bytes bigint,
  content_type text,
  status text not null default 'approved' check (status in ('pending','approved','rejected')),
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.otp_codes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  email citext not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('warm','hot','request')),
  event_id uuid references public.events on delete set null,
  email citext,
  name text,
  phone text,
  message text,
  utm jsonb,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  venue text not null,
  contact text not null,
  email citext not null,
  phone text,
  city text,
  country text,
  notes text,
  status text not null default 'pending_review',
  reviewed_by uuid references auth.users,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigserial primary key,
  actor_id uuid,
  actor_email text,
  action text not null,
  target_table text,
  target_id text,
  meta jsonb,
  at timestamptz not null default now()
);

-- ---------- indexes ----------

create index events_code_idx on public.events(code);
create index photos_event_status_idx on public.photos(event_id, status, uploaded_at desc);
create index otp_email_idx on public.otp_codes(email, expires_at);

-- ---------- row-level security ----------

alter table public.events enable row level security;
alter table public.guests enable row level security;
alter table public.photos enable row level security;
alter table public.otp_codes enable row level security;
alter table public.leads enable row level security;
alter table public.applications enable row level security;
alter table public.audit_log enable row level security;

-- events
create policy events_public_select on public.events
  for select using (status = 'live');

create policy events_host_select on public.events
  for select to authenticated
  using (host_user_id = auth.uid());

create policy events_host_update on public.events
  for update to authenticated
  using (host_user_id = auth.uid())
  with check (host_user_id = auth.uid());

create policy events_admin_all on public.events
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- guests: server-side only via service role. Hosts can read for their events.
create policy guests_host_select on public.guests
  for select to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = guests.event_id and e.host_user_id = auth.uid()
    )
  );

create policy guests_admin_all on public.guests
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- photos: public sees approved photos of live events; hosts manage their own.
create policy photos_public_select on public.photos
  for select using (status = 'approved' and public.event_is_live(event_id));

create policy photos_host_select on public.photos
  for select to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = photos.event_id and e.host_user_id = auth.uid()
    )
  );

create policy photos_host_update on public.photos
  for update to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = photos.event_id and e.host_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = photos.event_id and e.host_user_id = auth.uid()
    )
  );

create policy photos_host_delete on public.photos
  for delete to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = photos.event_id and e.host_user_id = auth.uid()
    )
  );

create policy photos_admin_all on public.photos
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- otp_codes / leads: service role only (no policies for non-service roles).
-- (Service role bypasses RLS by default — no explicit policy needed.)

-- applications: admin can select.
create policy applications_admin_select on public.applications
  for select to authenticated
  using (public.is_admin());

create policy applications_admin_update on public.applications
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- audit_log: admin select only.
create policy audit_admin_select on public.audit_log
  for select to authenticated
  using (public.is_admin());

-- ---------- storage buckets ----------

insert into storage.buckets (id, name, public)
values
  ('wall-photos', 'wall-photos', false),
  ('wall-thumbs', 'wall-thumbs', false)
on conflict (id) do nothing;

-- ---------- realtime ----------

-- Enable Realtime broadcasting on photos so the wall can subscribe.
alter publication supabase_realtime add table public.photos;

-- ---------- seed (matches legacy app.js demo codes) ----------

insert into public.events (code, couple_display, couple_html, when_text, status)
values
  (
    'MAYA-DANIEL',
    'Maya & Daniel',
    'Maya <em>&amp;</em> Daniel',
    'You''re invited · 14 June 2026',
    'live'
  ),
  (
    'ELENA-MARCUS',
    'Elena & Marcus',
    'Elena <em>&amp;</em> Marcus',
    'You''re invited · 5 July 2026',
    'live'
  )
on conflict (code) do update
  set couple_display = excluded.couple_display,
      couple_html   = excluded.couple_html,
      when_text     = excluded.when_text,
      status        = excluded.status;
