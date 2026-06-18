import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { verifyOtp } from "@/lib/db/otp";
import { getLiveEventByCode } from "@/lib/db/events";
import { GUEST_COOKIE, signGuestJwt } from "@/lib/guest-jwt";

const Body = z.object({
  code: z.string().min(1).max(64),
  email: z.string().email().max(320),
  otp: z.string().regex(/^\d{6}$/),
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
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await verifyOtp({
    eventId: event.id,
    email: parsed.data.email,
    code: parsed.data.otp,
  });

  if (!result.ok) {
    const status =
      result.reason === "locked"
        ? 429
        : result.reason === "expired"
          ? 410
          : 401;
    return NextResponse.json({ error: result.reason }, { status });
  }

  const token = await signGuestJwt({
    event_id: event.id,
    guest_id: result.guestId,
    email: parsed.data.email,
  });

  const store = await cookies();
  store.set(GUEST_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 24 * 60 * 60,
  });

  return NextResponse.json({ ok: true, guest_id: result.guestId });
}
