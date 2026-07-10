-- Storage hardening: cap object size and restrict MIME types per bucket.
--
-- The upload flow hands guests a signed upload URL and PUTs bytes directly to
-- Storage. Before this migration the buckets accepted arbitrary size/type; the
-- init route only validated the client-*claimed* byte count, and finalize
-- buffers the whole object into memory (lib/db/photos.ts downloadPhotoObject,
-- maxDuration=30) — an oversized PUT was an OOM/timeout vector. Supabase
-- enforces these limits at PUT time, before any app code runs.
--
-- 26_214_400 was considered but we use 25_000_000 to match MAX_BYTES in
-- lib/sharp/process.ts exactly. wall-photos MIME list mirrors
-- ALLOWED_CONTENT_TYPES; thumbs are always written as JPEG server-side; covers
-- accept the web-image types a host banner can be.

update storage.buckets
  set file_size_limit = 25000000,
      allowed_mime_types = array[
        'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
      ]
  where id = 'wall-photos';

update storage.buckets
  set file_size_limit = 25000000,
      allowed_mime_types = array['image/jpeg']
  where id = 'wall-thumbs';

update storage.buckets
  set file_size_limit = 25000000,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  where id = 'wall-covers';
