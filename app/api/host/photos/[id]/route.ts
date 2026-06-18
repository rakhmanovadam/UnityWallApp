import { NextResponse } from "next/server";
import { z } from "zod";
import { getHostContext } from "@/lib/host-session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });
const Body = z.object({
  status: z.enum(["approved", "rejected"]),
});

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsedParams = ParamsSchema.safeParse(await ctx.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "invalid_photo" }, { status: 400 });
  }

  const host = await getHostContext();
  if (!host) {
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

  const admin = createAdminClient();
  const { data: photo, error: lookupErr } = await admin
    .from("photos")
    .select("id, event_id")
    .eq("id", parsedParams.data.id)
    .maybeSingle();
  if (lookupErr || !photo) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const owned = host.events.find((e) => e.id === photo.event_id);
  if (!owned) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { error } = await admin
    .from("photos")
    .update({ status: parsed.data.status })
    .eq("id", parsedParams.data.id);
  if (error) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  await admin.from("audit_log").insert({
    actor_id: host.userId,
    actor_email: host.email,
    action: `host.${parsed.data.status}_photo`,
    target_table: "photos",
    target_id: parsedParams.data.id,
    meta: { event_id: photo.event_id },
  });

  return NextResponse.json({ ok: true });
}
