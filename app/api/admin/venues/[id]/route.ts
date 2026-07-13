import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminContext } from "@/lib/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdminVenueDetail } from "@/lib/db/admin-venues";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });

// Admin has full edit access to any venue — including archive, which hosts
// can't do themselves. Same validation as the host PATCH, plus "archived".
const HEX = /^#[0-9a-fA-F]{6}$/;
const hexColor = z.string().regex(HEX).nullable().optional();

const Patch = z.object({
  couple_display: z.string().min(1).max(256).optional(),
  when_text: z.string().min(1).max(256).optional(),
  status: z.enum(["draft", "live", "archived"]).optional(),
  wall_layout: z.enum(["mosaic", "feature", "grid"]).optional(),
  allow_uploads: z.boolean().optional(),
  require_moderation: z.boolean().optional(),
  max_uploads_per_guest: z.number().int().min(1).max(500).optional(),
  welcome_message: z.string().max(2000).nullable().optional(),
  retention_days: z.number().int().min(1).max(365).optional(),
  theme_primary: hexColor,
  theme_accent: hexColor,
  theme_bg: hexColor,
  theme_font: z
    .enum(["default", "classic", "modern", "elegant", "typewriter", "rounded"])
    .nullable()
    .optional(),
});

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminContext();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = ParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }
  const detail = await getAdminVenueDetail(parsed.data.id);
  if (!detail) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const adminCtx = await getAdminContext();
  if (!adminCtx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsedParams = ParamsSchema.safeParse(await ctx.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
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

  const db = createAdminClient();
  const update: Record<string, unknown> = { ...parsed.data };
  if (
    typeof update.welcome_message === "string" &&
    update.welcome_message.trim() === ""
  ) {
    update.welcome_message = null;
  }

  const { error } = await db
    .from("events")
    .update(update)
    .eq("id", parsedParams.data.id);
  if (error) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  await db.from("audit_log").insert({
    actor_id: adminCtx.userId,
    actor_email: adminCtx.email,
    action: "admin.update_event",
    target_table: "events",
    target_id: parsedParams.data.id,
    meta: parsed.data,
  });

  return NextResponse.json({ ok: true });
}
