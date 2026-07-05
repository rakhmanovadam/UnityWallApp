import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOwnedEvent } from "@/lib/host-session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });

// Cover images render as a full-bleed hero on the guest landing. 8 MB is
// generous for a wedding cover — anything larger is almost certainly an
// unedited camera raw the host should compress first, and the plan reserves
// heavy retention/purge concerns for the guest photo bucket.
const MAX_COVER_BYTES = 8_000_000;
const ALLOWED_COVER_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const Body = z.object({
  content_type: z.enum(ALLOWED_COVER_TYPES),
  bytes: z.number().int().positive().max(MAX_COVER_BYTES, "file_too_large"),
});

function extForType(ct: (typeof ALLOWED_COVER_TYPES)[number]) {
  if (ct === "image/jpeg") return "jpg";
  if (ct === "image/png") return "png";
  return "webp";
}

// Mints a signed upload URL for the host's cover image. The client PUTs the
// bytes to the URL and then PATCHes /api/host/events/[id] with
// cover_image_path set to the returned `path`. Path convention:
// <event_id>/<uuid>.<ext> — the event-id prefix is checked in the PATCH
// route to prevent a host from attaching another event's cover to their own.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsedParams = ParamsSchema.safeParse(await ctx.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }

  const owned = await requireOwnedEvent(parsedParams.data.id);
  if (!owned) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
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

  const ext = extForType(parsed.data.content_type);
  const path = `${owned.event.id}/${crypto.randomUUID()}.${ext}`;

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from("wall-covers")
    .createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json(
      { error: "signed_upload_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    path,
    upload_url: data.signedUrl,
    upload_token: data.token,
  });
}
