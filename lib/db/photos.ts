import { createAdminClient } from "@/lib/supabase/admin";

export const PHOTOS_BUCKET = "wall-photos";
export const THUMBS_BUCKET = "wall-thumbs";

export type PhotoStatus = "pending" | "approved" | "rejected";

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
