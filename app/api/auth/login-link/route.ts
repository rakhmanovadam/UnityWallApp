import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, signInEmail } from "@/lib/email/resend";
import { serverEnv } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Server-issued sign-in magic link for host/admin login. We generate the link
// with the service role and deliver it via Resend, bypassing Supabase's
// built-in SMTP (rate-limited, unreliable). The link points at /auth/callback
// carrying the token_hash, which the callback exchanges for a session.
//
// Security: responds ok:true regardless of whether the email has an account,
// so this can't be used to enumerate users. Role is still enforced at the
// /admin gate — emailing a link never grants admin.

const Body = z.object({
  email: z.string().email().max(320),
  audience: z.enum(["admin", "host"]).optional(),
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

  const email = parsed.data.email.trim().toLowerCase();
  const audience = parsed.data.audience ?? "host";

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "0.0.0.0";
  const rl = await rateLimit("otp", `login:${ip}:${email}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const env = serverEnv();
  const base = env.APP_BASE_URL.replace(/\/$/, "");
  const next = audience === "admin" ? "/admin" : "/dashboard";

  const db = createAdminClient();
  try {
    const { data, error } = await db.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    // generateLink errors for non-existent users — swallow so we don't leak
    // which emails have accounts.
    if (!error && data?.properties?.hashed_token) {
      const { hashed_token, verification_type } = data.properties;
      const link =
        `${base}/auth/callback` +
        `?token_hash=${encodeURIComponent(hashed_token)}` +
        `&type=${encodeURIComponent(verification_type)}` +
        `&next=${encodeURIComponent(next)}`;
      const tpl = signInEmail({ magicLink: link, audience });
      await sendEmail({
        to: email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
    }
  } catch {
    // Never reveal account existence or delivery errors to the client.
  }

  return NextResponse.json({ ok: true });
}
