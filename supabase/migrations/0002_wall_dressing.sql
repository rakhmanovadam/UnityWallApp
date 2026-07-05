-- UnityWall schema v0002
--
-- Adds three plan-required columns:
--   events.welcome_message   — host-supplied text shown under the couple
--                              name on the guest landing / wall.
--   events.cover_image_path  — reserved for the host cover-image upload
--                              flow. Nullable so existing rows stay valid;
--                              guest wall falls back to the CSS gradient
--                              until it's set.
--   applications.rejection_reason — captured by the admin decline modal so
--                              the applicant email can quote the reason
--                              back to them, and support has a paper trail.

alter table public.events
  add column if not exists welcome_message text,
  add column if not exists cover_image_path text;

alter table public.applications
  add column if not exists rejection_reason text;
