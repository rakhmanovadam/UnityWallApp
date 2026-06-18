import { NextResponse } from "next/server";
import { z } from "zod";
import { insertLead } from "@/lib/db/leads";
import { sendEmail, leadNotificationEmail } from "@/lib/email/resend";
import { serverEnv } from "@/lib/env";
import { getLiveEventByCode } from "@/lib/db/events";

const Body = z.object({
  source: z.enum(["warm", "hot"]),
  code: z.string().min(1).max(64).optional(),
  email: z.string().email().max(320).nullable().optional(),
  name: z.string().max(256).nullable().optional(),
  phone: z.string().max(64).nullable().optional(),
  message: z.string().max(4000).nullable().optional(),
  utm: z.record(z.string(), z.string()).nullable().optional(),
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

  let eventId: string | null = null;
  let eventCode: string | null = null;
  if (parsed.data.code) {
    const event = await getLiveEventByCode(parsed.data.code);
    if (event) {
      eventId = event.id;
      eventCode = event.code;
    }
  }

  try {
    await insertLead({
      source: parsed.data.source,
      eventId,
      email: parsed.data.email ?? null,
      name: parsed.data.name ?? null,
      phone: parsed.data.phone ?? null,
      message: parsed.data.message ?? null,
      utm: parsed.data.utm ?? null,
    });

    // Hot leads always notify; warm leads also notify (admin wants visibility
    // into scroll-through interest). If this gets noisy, gate on `source==="hot"`.
    try {
      const env = serverEnv();
      const tpl = leadNotificationEmail({
        source: parsed.data.source,
        email: parsed.data.email ?? null,
        name: parsed.data.name ?? null,
        message: parsed.data.message ?? null,
        eventCode,
        utm: parsed.data.utm ?? null,
      });
      await sendEmail({
        to: env.ADMIN_NOTIFY_EMAIL,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
    } catch {
      // Email failure should not break the lead capture flow.
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
