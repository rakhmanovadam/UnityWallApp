import { createAdminClient } from "@/lib/supabase/admin";

export const PHOTOS_BUCKET = "wall-photos";
export const THUMBS_BUCKET = "wall-thumbs";

export type PhotoStatus = "pending" | "approved" | "rejected";

// Live-status gate for the public read paths. These functions use the
// service-role client (bypassing RLS), so they must re-assert the same
// condition the RLS policy `photos_public_select` enforces —
// `event_is_live(event_id)` — or approved photos of draft/archived walls
// would stay publicly retrievable by anyone holding the event UUID.
async function isEventLive(
  admin: ReturnType<typeof createAdminClient>,
  eventId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("events")
    .select("status")
    .eq("id", eventId)
    .maybeSingle();
  return data?.status === "live";
}

// Count of a guest's existing photos on an event. Used to enforce the
// per-guest upload cap at init time.
export async function countGuestPhotos(
  eventId: string,
  guestId: string,
): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("photos")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("guest_id", guestId);
  return count ?? 0;
}

export async function insertPendingPhoto(opts: {
  id?: string;
  eventId: string;
  guestId: string;
  storagePath: string;
  contentType: string;
}) {
  const admin = createAdminClient();
  const row: Record<string, unknown> = {
    event_id: opts.eventId,
    guest_id: opts.guestId,
    storage_path: opts.storagePath,
    content_type: opts.contentType,
    status: "pending",
  };
  if (opts.id) row.id = opts.id;
  const { data, error } = await admin
    .from("photos")
    .insert(row)
    .select("id")
    .single();
  if (error || !data) throw new Error(`photo_insert_failed: ${error?.message}`);
  return data.id as string;
}

export async function finalizePhoto(opts: {
  photoId: string;
  thumbPath: string;
  width: number;
  height: number;
  bytes: number;
  status: PhotoStatus;
  finalContentType: string;
  finalStoragePath?: string;
}) {
  const admin = createAdminClient();
  const patch: Record<string, unknown> = {
    thumb_path: opts.thumbPath,
    width: opts.width,
    height: opts.height,
    bytes: opts.bytes,
    content_type: opts.finalContentType,
    status: opts.status,
  };
  if (opts.finalStoragePath) patch.storage_path = opts.finalStoragePath;
  const { error } = await admin
    .from("photos")
    .update(patch)
    .eq("id", opts.photoId);
  if (error) throw new Error(`photo_finalize_failed: ${error.message}`);
}

export async function getPhotoForFinalize(photoId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("photos")
    .select("id, event_id, guest_id, storage_path, content_type, status")
    .eq("id", photoId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function createSignedUploadUrl(path: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(PHOTOS_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    throw new Error(`signed_upload_failed: ${error?.message}`);
  }
  return data;
}

export async function downloadPhotoObject(path: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(PHOTOS_BUCKET).download(path);
  if (error || !data) {
    throw new Error(`download_failed: ${error?.message}`);
  }
  const arr = await data.arrayBuffer();
  return Buffer.from(arr);
}

export async function uploadProcessedFull(opts: {
  path: string;
  body: Buffer;
  contentType: string;
}) {
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(PHOTOS_BUCKET)
    .upload(opts.path, opts.body, {
      contentType: opts.contentType,
      upsert: true,
    });
  if (error) throw new Error(`upload_full_failed: ${error.message}`);
}

export async function uploadProcessedThumb(opts: {
  path: string;
  body: Buffer;
}) {
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(THUMBS_BUCKET)
    .upload(opts.path, opts.body, {
      contentType: "image/jpeg",
      upsert: true,
    });
  if (error) throw new Error(`upload_thumb_failed: ${error.message}`);
}

// Public read access happens via short-lived signed URLs minted server-side.
export async function signedThumbUrl(path: string, expiresInSeconds = 3600) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(THUMBS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) throw new Error(`signed_thumb_failed: ${error?.message}`);
  return data.signedUrl;
}

export type PhotoListItem = {
  id: string;
  thumb_url: string;
  caption: string | null;
  width: number | null;
  height: number | null;
  uploaded_at: string;
};

export type PhotoListResult = {
  items: PhotoListItem[];
  next_cursor: string | null;
};

// Lists approved photos for a live event, newest first. Uses signed thumb
// URLs (1h TTL) so the underlying bucket stays private. Cursor is the
// ISO uploaded_at of the last item in the previous page.
export async function listApprovedPhotos(opts: {
  eventId: string;
  cursor?: string | null;
  limit?: number;
}): Promise<PhotoListResult> {
  const admin = createAdminClient();
  if (!(await isEventLive(admin, opts.eventId))) {
    return { items: [], next_cursor: null };
  }
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);

  let query = admin
    .from("photos")
    .select("id, caption, width, height, uploaded_at, thumb_path, status")
    .eq("event_id", opts.eventId)
    .eq("status", "approved")
    .order("uploaded_at", { ascending: false })
    .limit(limit + 1);

  if (opts.cursor) {
    query = query.lt("uploaded_at", opts.cursor);
  }

  const { data, error } = await query;
  if (error || !data) return { items: [], next_cursor: null };

  const rows = data.slice(0, limit);
  const hasMore = data.length > limit;

  const signed = await Promise.all(
    rows.map(async (row) => {
      if (!row.thumb_path) return null;
      try {
        const url = await signedThumbUrl(row.thumb_path, 3600);
        return {
          id: row.id,
          thumb_url: url,
          caption: row.caption,
          width: row.width,
          height: row.height,
          uploaded_at: row.uploaded_at,
        } satisfies PhotoListItem;
      } catch {
        return null;
      }
    }),
  );

  return {
    items: signed.filter((x): x is PhotoListItem => x !== null),
    next_cursor: hasMore ? rows[rows.length - 1].uploaded_at : null,
  };
}

// Guest self-service delete. Verifies the photo belongs to this guest + event
// before removing storage objects (full + thumb) and the row. Storage removal
// is best-effort — a lingering object never blocks the row delete. Returns
// false when the photo is missing or not owned by this guest, so the caller
// can 404 without leaking whether the id exists.
export async function deleteOwnPhoto(opts: {
  photoId: string;
  eventId: string;
  guestId: string;
}): Promise<boolean> {
  const admin = createAdminClient();
  const { data: photo, error } = await admin
    .from("photos")
    .select("id, event_id, guest_id, storage_path, thumb_path")
    .eq("id", opts.photoId)
    .maybeSingle();
  if (error || !photo) return false;
  if (photo.event_id !== opts.eventId || photo.guest_id !== opts.guestId) {
    return false;
  }

  if (photo.storage_path) {
    await admin.storage.from(PHOTOS_BUCKET).remove([photo.storage_path]);
  }
  if (photo.thumb_path) {
    await admin.storage.from(THUMBS_BUCKET).remove([photo.thumb_path]);
  }

  const { error: delErr } = await admin
    .from("photos")
    .delete()
    .eq("id", opts.photoId);
  return !delErr;
}

export async function getApprovedThumbForPhoto(opts: {
  photoId: string;
  eventId: string;
}): Promise<PhotoListItem | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("photos")
    .select("id, caption, width, height, uploaded_at, thumb_path, status, event_id")
    .eq("id", opts.photoId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.event_id !== opts.eventId) return null;
  if (data.status !== "approved" || !data.thumb_path) return null;
  if (!(await isEventLive(admin, data.event_id))) return null;
  try {
    const url = await signedThumbUrl(data.thumb_path, 3600);
    return {
      id: data.id,
      thumb_url: url,
      caption: data.caption,
      width: data.width,
      height: data.height,
      uploaded_at: data.uploaded_at,
    };
  } catch {
    return null;
  }
}
