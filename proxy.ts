import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { rateLimit } from "@/lib/rate-limit";

const HOST_PATH = /^\/dashboard(\/|$)/;
const ADMIN_PATH = /^\/admin(\/|$)/;

const OTP_API = /^\/api\/otp\//;
const LEADS_API = /^\/api\/leads(\/|$)/;
const APPLICATIONS_API = /^\/api\/applications(\/|$)/;
const UPLOADS_API = /^\/api\/uploads\//;

// Unauthenticated photo reads: the wall's photo list and the single-thumb
// signer. Both hit Storage / mint signed URLs on every call, so they get a
// per-IP GET budget of their own.
const PUBLIC_PHOTOS_API = /^\/api\/events\/[^/]+\/photos$/;
const PUBLIC_SIGN_API = /^\/api\/photos\/[^/]+\/sign$/;

function clientIp(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "0.0.0.0"
  );
}

function rateLimited(retryAfter: number) {
  return new NextResponse(JSON.stringify({ error: "rate_limited" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
    },
  });
}

// Per-request CSP. script-src pins to a nonce + strict-dynamic in production so
// an HTML injection can't execute inline script; dev keeps unsafe-inline/eval
// because React/Turbopack require eval() for source maps. The nonce is set on
// the request header too, which is how Next.js propagates it to the framework
// <script> tags it emits.
function buildCsp(nonce: string) {
  const isDev = process.env.NODE_ENV !== "production";
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://*.supabase.co",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Rate limit by IP. POSTs to mutation-heavy surfaces, plus the two
  //    unauthenticated photo GETs.
  const ip = clientIp(request);
  if (request.method === "POST") {
    let bucket: "otp" | "leads" | "applications" | "uploads" | null = null;
    if (OTP_API.test(pathname)) bucket = "otp";
    else if (LEADS_API.test(pathname)) bucket = "leads";
    else if (APPLICATIONS_API.test(pathname)) bucket = "applications";
    else if (UPLOADS_API.test(pathname)) bucket = "uploads";

    if (bucket) {
      const result = await rateLimit(bucket, `${bucket}:${ip}`);
      if (!result.allowed) return rateLimited(result.retryAfter);
    }
  } else if (request.method === "GET") {
    if (PUBLIC_PHOTOS_API.test(pathname) || PUBLIC_SIGN_API.test(pathname)) {
      const result = await rateLimit("public_read", `public_read:${ip}`);
      if (!result.allowed) return rateLimited(result.retryAfter);
    }
  }

  // 2. Build the CSP nonce and forward it on the request headers so Next.js
  //    can stamp it onto its inline scripts.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  // 3. Refresh Supabase session cookie on every request + read user.
  const { response, user } = await updateSession(request, requestHeaders);
  response.headers.set("Content-Security-Policy", csp);

  // 4. Gate host/admin routes.
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
