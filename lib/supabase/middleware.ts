import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";

// Refreshes the Supabase auth cookie on every request. Returns the response
// that callers should return (with the refreshed cookies attached) and the
// resolved user for downstream role checks.
//
// `requestHeaders` lets the caller forward a mutated header set (e.g. the CSP
// nonce headers) onto the outgoing request so Next.js sees them when rendering.
// When omitted, the original request headers pass through unchanged.
export async function updateSession(
  request: NextRequest,
  requestHeaders?: Headers,
) {
  const headers = requestHeaders ?? new Headers(request.headers);
  let response = NextResponse.next({ request: { headers } });

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request: { headers } });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
