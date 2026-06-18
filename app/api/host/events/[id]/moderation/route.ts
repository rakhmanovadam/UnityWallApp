import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOwnedEvent } from "@/lib/host-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { signedThumbUrl } from "@/lib/db/photos";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  _request: Request,
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

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("photos")
    .select("id, caption, thumb_path, uploaded_at, status")
    .eq("event_id", parsedParams.data.id)
    .eq("status", "pending")
    .order("uploaded_at", { ascending: true })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  const items = await Promise.all(
    (data ?? []).map(async (row) => ({
      id: row.id,
      caption: row.caption,
      uploaded_at: row.uploaded_at,
      thumb_url: row.thumb_path ? await signedThumbUrl(row.thumb_path) : null,
    })),
  );

  return NextResponse.json({ items });
}
