import { cookies } from "next/headers";
import { GUEST_COOKIE, verifyGuestJwt, type GuestClaims } from "@/lib/guest-jwt";

// Reads + verifies the uw_guest cookie. Returns null if absent, expired,
// tampered with, or signed with a different secret. Always async — Next 16
// cookies() is async.
export async function getGuestSession(): Promise<GuestClaims | null> {
  const store = await cookies();
  const token = store.get(GUEST_COOKIE)?.value;
  if (!token) return null;
  return await verifyGuestJwt(token);
}

// For routes that require a guest. Returns claims or null; the caller is
// responsible for the 401 response shape.
export async function requireGuestForEvent(
  eventId: string,
): Promise<GuestClaims | null> {
  const claims = await getGuestSession();
  if (!claims) return null;
  if (claims.event_id !== eventId) return null;
  return claims;
}
