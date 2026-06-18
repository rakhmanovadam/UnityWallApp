import { NextResponse } from "next/server";
import { z } from "zod";
import { getGuestSession } from "@/lib/guest-session";
import {
  createSignedUploadUrl,
  insertPendingPhoto,
} from "@/lib/db/photos";
import {
  ALLOWED_CONTENT_TYPES,
  MAX_BYTES,
  extForContentType,
} from "@/lib/sharp/process";

export const runtime = "nodejs";

const Body = z.object({
  filename: z.string().min(1).max(256),
  content_type: z.enum(
    ALLOWED_CONTENT_TYPES as unknown as [string, ...string[]],
  ),
  bytes: z
    .number()
    .int()
    .positive()
    .max(MAX_BYTES, "file_too_large"),
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

  try {
    const ext = extForContentType(parsed.data.content_type);
    // Reserve a deterministic path so finalize can find it without trusting
    // the client. photo_id is the path leaf; event_id scopes the prefix.
    const photoId = crypto.randomUUID();
    const storagePath = `${guest.event_id}/${photoId}.${ext}`;

    await insertPendingPhoto({
      id: photoId,
      eventId: guest.event_id,
      guestId: guest.guest_id,
      storagePath,
      contentType: parsed.data.content_type,
    });

    const signed = await createSignedUploadUrl(storagePath);

    return NextResponse.json({
      photo_id: photoId,
      upload_url: signed.signedUrl,
      upload_token: signed.token,
      path: signed.path,
    });
  } catch {
    return NextResponse.json({ error: "init_failed" }, { status: 500 });
  }
}
