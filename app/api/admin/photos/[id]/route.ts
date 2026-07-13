import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminContext } from "@/lib/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { setPhotoStatusAdmin } from "@/lib/db/admin-venues";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });
const Patch = z.object({ status: z.enum(["approved", "rejected"]) });

// Admin moderation for any photo on any venue. Hosts moderate via
// /api/host/photos/[id]; this is the same action without the ownership gate.
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
    return NextResponse.json({ error: "invalid_photo" }, { status: 400 });
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

  const ok = await setPhotoStatusAdmin(parsedParams.data.id, parsed.data.status);
  if (!ok) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  const db = createAdminClient();
  await db.from("audit_log").insert({
    actor_id: adminCtx.userId,
    actor_email: adminCtx.email,
    action: `admin.${parsed.data.status}_photo`,
    target_table: "photos",
    target_id: parsedParams.data.id,
    meta: { status: parsed.data.status },
  });

  return NextResponse.json({ ok: true });
}
