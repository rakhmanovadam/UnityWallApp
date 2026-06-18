import { NextResponse } from "next/server";
import { z } from "zod";
import { getApprovedThumbForPhoto } from "@/lib/db/photos";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsedParams = ParamsSchema.safeParse(await ctx.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "invalid_photo" }, { status: 400 });
  }
  const url = new URL(request.url);
  const eventId = url.searchParams.get("event_id");
  if (!eventId || !z.string().uuid().safeParse(eventId).success) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }

  const item = await getApprovedThumbForPhoto({
    photoId: parsedParams.data.id,
    eventId,
  });

  if (!item) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ item });
}
