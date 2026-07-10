import { NextResponse } from "next/server";
import { z } from "zod";
import { getGuestSession } from "@/lib/guest-session";
import { deleteOwnPhoto } from "@/lib/db/photos";

export const runtime = "nodejs";

// Guest self-service photo delete. A guest can remove only the photos they
// uploaded on this wall — ownership is checked against the signed guest cookie
// (event_id + guest_id), never trusting the client. Hosts moderate via their
// own dashboard path; this route is guest-scoped.
const Body = z.object({
  photo_id: z.string().uuid(),
});

export async function POST(request: Request) {
  const guest = await getGuestSession();
  if (!guest) {
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

  const ok = await deleteOwnPhoto({
    photoId: parsed.data.photo_id,
    eventId: guest.event_id,
    guestId: guest.guest_id,
  });
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
