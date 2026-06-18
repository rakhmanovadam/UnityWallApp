import { NextResponse } from "next/server";
import { z } from "zod";
import { getGuestSession } from "@/lib/guest-session";
import {
  downloadPhotoObject,
  finalizePhoto,
  getPhotoForFinalize,
  uploadProcessedFull,
  uploadProcessedThumb,
} from "@/lib/db/photos";
import { processImage } from "@/lib/sharp/process";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({
  photo_id: z.string().uuid(),
});

export async function POST(request: Request) {
  const guest = await getGuestSession();
  if (!guest) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const photo = await getPhotoForFinalize(parsed.data.photo_id);
  if (!photo) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (photo.event_id !== guest.event_id || photo.guest_id !== guest.guest_id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (photo.status !== "pending") {
    // Already finalized — idempotent return.
    return NextResponse.json({ ok: true, already_finalized: true });
  }

  try {
    const original = await downloadPhotoObject(photo.storage_path);
    const processed = await processImage(original, photo.content_type ?? "");

    // Path naming after processing: HEIC/HEIF inputs become JPEGs, so the
    // canonical storage path now ends in .jpg. Older variants (.heic) get
    // left in place to avoid breaking the signed-upload contract; the new
    // final lives alongside.
    const fullPath =
      processed.fullContentType === "image/jpeg"
        ? photo.storage_path.replace(/\.(heic|heif|png|webp)$/i, ".jpg")
        : photo.storage_path;
    const thumbPath = `${guest.event_id}/${photo.id}.jpg`;

    if (fullPath !== photo.storage_path) {
      // Overwrite at the new path, drop the staging upload.
      await uploadProcessedFull({
        path: fullPath,
        body: processed.fullBuffer,
        contentType: processed.fullContentType,
      });
      await createAdminClient()
        .storage.from("wall-photos")
        .remove([photo.storage_path]);
    } else {
      await uploadProcessedFull({
        path: fullPath,
        body: processed.fullBuffer,
        contentType: processed.fullContentType,
      });
    }

    await uploadProcessedThumb({
      path: thumbPath,
      body: processed.thumbBuffer,
    });

    // require_moderation gate: read from the event row.
    const admin = createAdminClient();
    const { data: ev } = await admin
      .from("events")
      .select("require_moderation")
      .eq("id", guest.event_id)
      .maybeSingle();
    const status = ev?.require_moderation ? "pending" : "approved";

    await finalizePhoto({
      photoId: photo.id,
      thumbPath,
      width: processed.width,
      height: processed.height,
      bytes: processed.fullBuffer.byteLength,
      status,
      finalContentType: processed.fullContentType,
      finalStoragePath: fullPath !== photo.storage_path ? fullPath : undefined,
    });

    return NextResponse.json({ ok: true, status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    if (msg === "unreadable_image" || msg.startsWith("Input file")) {
      return NextResponse.json(
        { error: "unsupported_image" },
        { status: 415 },
      );
    }
    return NextResponse.json({ error: "finalize_failed" }, { status: 500 });
  }
}
