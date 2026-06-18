import { NextResponse } from "next/server";
import { z } from "zod";
import { listApprovedPhotos } from "@/lib/db/photos";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsedParams = ParamsSchema.safeParse(await ctx.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");

  const result = await listApprovedPhotos({
    eventId: parsedParams.data.id,
    cursor: cursor && cursor.length > 0 ? cursor : null,
  });

  return NextResponse.json(result);
}
