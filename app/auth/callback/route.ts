import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Supabase magic-link / OTP-email callback. The email link (PKCE flow) sends
// the browser back here with a `?code=`; older token-hash templates send
// `?token_hash=&type=`. Either way we must exchange it for a session cookie
// server-side — without this handler the code is never consumed and the user
// bounces back to the login screen with no session.
//
// `next` is the post-login destination (/admin or /dashboard). We only allow
// same-origin relative paths to avoid an open-redirect.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  const nextParam = searchParams.get("next") || "/dashboard";
  const next =
    nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : "/dashboard";

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as "magiclink" | "email" | "recovery" | "invite" | "signup",
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  // Exchange failed or no credentials present — send back to the login screen
  // with a flag the page can surface.
  return NextResponse.redirect(`${origin}${next}?auth_error=1`);
}
