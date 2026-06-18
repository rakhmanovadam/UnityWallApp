import { NextResponse } from "next/server";
import { z } from "zod";
import { issueOtp } from "@/lib/db/otp";
import { sendEmail, otpEmail } from "@/lib/email/resend";
import { getLiveEventByCode } from "@/lib/db/events";
import { rateLimit } from "@/lib/rate-limit";

const Body = z.object({
  code: z.string().min(1).max(64),
  email: z.string().email().max(320),
  marketing_opt_in: z.boolean().optional().default(false),
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

  // Per-email rate limit. The middleware already enforces per-IP. Together:
  // an attacker can't spray one inbox or one IP with codes.
  const limit = await rateLimit(
    "otp_email",
    `otp_email:${event.id}:${parsed.data.email.toLowerCase()}`,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  try {
    const { code } = await issueOtp({
      eventId: event.id,
      email: parsed.data.email,
      marketingOptIn: parsed.data.marketing_opt_in,
    });

    const tpl = otpEmail(code);
    await sendEmail({
      to: parsed.data.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "send_failed" }, { status: 500 });
  }
}
