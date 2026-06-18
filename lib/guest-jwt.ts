import { SignJWT, jwtVerify } from "jose";
import { serverEnv } from "@/lib/env";

export const GUEST_COOKIE = "uw_guest";

export type GuestClaims = {
  event_id: string;
  guest_id: string;
  email: string;
};

function secret() {
  return new TextEncoder().encode(serverEnv().GUEST_JWT_SECRET);
}

export async function signGuestJwt(claims: GuestClaims) {
  return await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secret());
}

export async function verifyGuestJwt(token: string): Promise<GuestClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
    });
    if (
      typeof payload.event_id === "string" &&
      typeof payload.guest_id === "string" &&
      typeof payload.email === "string"
    ) {
      return {
        event_id: payload.event_id,
        guest_id: payload.guest_id,
        email: payload.email,
      };
    }
    return null;
  } catch {
    return null;
  }
}
