import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { insertApplication } from "@/lib/db/applications";
import { upsertLead } from "@/lib/db/leads";
import {
  sendEmail,
  applicationNotificationEmail,
  applicationAckEmail,
} from "@/lib/email/resend";
import { serverEnv } from "@/lib/env";

const Body = z.object({
  venue: z.string().min(1).max(256),
  contact: z.string().min(1).max(256),
  email: z.string().email().max(320),
  phone: z.string().max(64).optional().nullable(),
  city: z.string().max(128).optional().nullable(),
  country: z.string().max(128).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

const APPLY_EMAIL_COOKIE = "uw_apply_email";

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

  try {
    await insertApplication({
      venue: parsed.data.venue,
      contact: parsed.data.contact,
      email: parsed.data.email,
      phone: parsed.data.phone ?? null,
      city: parsed.data.city ?? null,
      country: parsed.data.country ?? null,
      notes: parsed.data.notes ?? null,
    });

    // Mirror into leads so the funnel report can include the applicant.
    // upsertLead treats 'request' at the same rank as 'hot' so it will
    // overwrite an earlier warm scroll but not clobber a live hot record.
    // person_type: "venue_host" is a permanent upgrade — anyone who fills
    // out the venue application is committed enough that the admin master
    // email table should separate them from photo-upload guests.
    try {
      await upsertLead({
        source: "request",
        email: parsed.data.email,
        name: parsed.data.contact,
        phone: parsed.data.phone ?? null,
        message: parsed.data.notes ?? null,
        personType: "venue_host",
      });
    } catch {
      // best-effort
    }

    const env = serverEnv();
    try {
      const tpl = applicationNotificationEmail({
        venue: parsed.data.venue,
        contact: parsed.data.contact,
        email: parsed.data.email,
        phone: parsed.data.phone ?? null,
        city: parsed.data.city ?? null,
        country: parsed.data.country ?? null,
        notes: parsed.data.notes ?? null,
      });
      await sendEmail({
        to: env.ADMIN_NOTIFY_EMAIL,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
    } catch {}

    try {
      const ack = applicationAckEmail({ venue: parsed.data.venue });
      await sendEmail({
        to: parsed.data.email,
        subject: ack.subject,
        html: ack.html,
        text: ack.text,
      });
    } catch {}

    // Stash email so /request/sent can render "We'll email <strong>...</strong>"
    // without exposing the row to the client.
    const store = await cookies();
    store.set(APPLY_EMAIL_COOKIE, parsed.data.email, {
      httpOnly: false,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
