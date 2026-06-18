import { NextResponse } from "next/server";
import { z } from "zod";
import { getLiveEventByCode } from "@/lib/db/events";

const Body = z.object({
  code: z.string().min(1).max(64),
});

export async function POST(request: Request) {
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

  const event = await getLiveEventByCode(parsed.data.code);
  if (!event) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ event });
}
