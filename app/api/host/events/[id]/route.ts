import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOwnedEvent } from "@/lib/host-session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });

// couple_html is intentionally NOT accepted from hosts anymore. The guest wall
// used to render it via dangerouslySetInnerHTML, which gave any host a stored
// XSS primitive against their own guests. couple_display is now the only text
// field and always rendered as React children. See lib/render.tsx.
// Hosts can only flip between draft ↔ live themselves; archiving is a
// destructive admin action gated at the console (events_admin_all policy),
// so it's not exposed here.
// welcome_message is capped at 2000 chars: enough for a couple-paragraph
// message from the couple, small enough not to blow out the guest hero.
// Passing an empty string clears the field (turns into null server-side).
// cover_image_path accepts either the exact "<event_id>/<name>" path that
// the cover-init route just minted, or null to clear. Anything else is
// rejected — a host can't attach another event's cover to their own wall.
// theme_* fields tint the guest wall. Colors are validated as 6-digit hex so
// nothing but a safe token can land inside a CSS custom property on the guest
// page; passing null clears the override back to the default UnityWall theme.
// theme_font is one of the fixed preset keys the client knows how to render.
const HEX = /^#[0-9a-fA-F]{6}$/;
const hexColor = z
  .string()
  .regex(HEX, "must be a #RRGGBB hex color")
  .nullable()
  .optional();

const Patch = z.object({
  wall_layout: z.enum(["mosaic", "feature", "grid"]).optional(),
  allow_uploads: z.boolean().optional(),
  require_moderation: z.boolean().optional(),
  couple_display: z.string().min(1).max(256).optional(),
  when_text: z.string().min(1).max(256).optional(),
  status: z.enum(["draft", "live"]).optional(),
  welcome_message: z.string().max(2000).nullable().optional(),
  cover_image_path: z.string().max(512).nullable().optional(),
  retention_days: z.number().int().min(1).max(365).optional(),
  max_uploads_per_guest: z.number().int().min(1).max(500).optional(),
  theme_primary: hexColor,
  theme_accent: hexColor,
  theme_bg: hexColor,
  theme_font: z
    .enum(["default", "classic", "modern", "elegant", "typewriter", "rounded"])
    .nullable()
    .optional(),
});

export async function PATCH(
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

  const parsed = Patch.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "empty_patch" }, { status: 400 });
  }

  const admin = createAdminClient();
  // Empty-string welcome_message normalizes to null so the guest wall's
  // "if (welcome_message)" render check treats "" and "no message" the same.
  const update: Record<string, unknown> = { ...parsed.data };
  if (typeof update.welcome_message === "string" && update.welcome_message.trim() === "") {
    update.welcome_message = null;
  }
  // cover_image_path is a full storage key. Require the event_id/ prefix so
  // a host can't repoint their cover at another event's file (or a random
  // path a service-role client wrote). null clears; anything else must
  // start with the owner's event id.
  if (typeof update.cover_image_path === "string") {
    const expectedPrefix = `${parsedParams.data.id}/`;
    if (!update.cover_image_path.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: "invalid_cover_path" }, { status: 400 });
    }
  }
  const { error } = await admin
    .from("events")
    .update(update)
    .eq("id", parsedParams.data.id);
  if (error) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  await admin.from("audit_log").insert({
    actor_id: owned.ctx.userId,
    actor_email: owned.ctx.email,
    action: "host.update_event",
    target_table: "events",
    target_id: parsedParams.data.id,
    meta: parsed.data,
  });

  return NextResponse.json({ ok: true });
}
