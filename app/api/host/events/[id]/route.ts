import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOwnedEvent } from "@/lib/host-session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });

const Patch = z.object({
  wall_layout: z.enum(["mosaic", "feature", "grid"]).optional(),
  allow_uploads: z.boolean().optional(),
  require_moderation: z.boolean().optional(),
  couple_display: z.string().min(1).max(256).optional(),
  couple_html: z.string().max(2000).optional(),
  when_text: z.string().min(1).max(256).optional(),
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
  const { error } = await admin
    .from("events")
    .update(parsed.data)
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
