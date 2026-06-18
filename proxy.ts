import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { rateLimit } from "@/lib/rate-limit";

const HOST_PATH = /^\/dashboard(\/|$)/;
const ADMIN_PATH = /^\/admin(\/|$)/;

const OTP_API = /^\/api\/otp\//;
const LEADS_API = /^\/api\/leads(\/|$)/;
const APPLICATIONS_API = /^\/api\/applications(\/|$)/;
const UPLOADS_API = /^\/api\/uploads\//;

function clientIp(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "0.0.0.0"
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Rate limit POSTs to mutation-heavy API surfaces.
  if (request.method === "POST") {
    const ip = clientIp(request);
    let bucket: "otp" | "leads" | "applications" | "uploads" | null = null;
    if (OTP_API.test(pathname)) bucket = "otp";
    else if (LEADS_API.test(pathname)) bucket = "leads";
    else if (APPLICATIONS_API.test(pathname)) bucket = "applications";
    else if (UPLOADS_API.test(pathname)) bucket = "uploads";

    if (bucket) {
      const result = await rateLimit(bucket, `${bucket}:${ip}`);
      if (!result.allowed) {
        return new NextResponse(
          JSON.stringify({ error: "rate_limited" }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(result.retryAfter),
            },
          },
        );
      }
    }
  }

  // 2. Refresh Supabase session cookie on every request + read user.
  const { response, user } = await updateSession(request);

  // 3. Gate host/admin routes.
  const isHost = HOST_PATH.test(pathname);
  const isAdmin = ADMIN_PATH.test(pathname);
  if ((isHost || isAdmin) && !user) {
    // Unauth host/admin land on the same path — the login template renders
    // when no session is present. We leave routing to the page itself but
    // surface 401 for nested API calls.
    if (pathname.startsWith("/api/")) {
      return new NextResponse(
        JSON.stringify({ error: "unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  if (isAdmin && user) {
    const role =
      (user.app_metadata as { role?: string } | undefined)?.role ?? null;
    if (role !== "admin" && pathname.startsWith("/api/")) {
      return new NextResponse(
        JSON.stringify({ error: "forbidden" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Run on everything except static assets and image optimization.
    "/((?!_next/static|_next/image|favicon.ico|assets/|styles.css|icon-.*|manifest.webmanifest|sw.js).*)",
  ],
};
