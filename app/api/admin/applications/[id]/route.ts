import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminContext } from "@/lib/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, hostInviteEmail } from "@/lib/email/resend";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });
const Body = z.object({
  action: z.enum(["approve", "decline"]),
});

function codeFromVenue(venue: string) {
  const base = venue
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base || "WALL"}-${suffix}`;
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsedParams = ParamsSchema.safeParse(await ctx.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "invalid_application" }, { status: 400 });
  }

  const admin = await getAdminContext();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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

  const db = createAdminClient();
  const { data: app, error: appErr } = await db
    .from("applications")
    .select("id, venue, contact, email, status")
    .eq("id", parsedParams.data.id)
    .maybeSingle();
  if (appErr || !app) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (app.status !== "pending_review") {
    return NextResponse.json({ error: "already_decided" }, { status: 409 });
  }

  if (parsed.data.action === "decline") {
    const { error } = await db
      .from("applications")
      .update({
        status: "declined",
        reviewed_by: admin.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", app.id);
    if (error) {
      return NextResponse.json({ error: "update_failed" }, { status: 500 });
    }
    await db.from("audit_log").insert({
      actor_id: admin.userId,
      actor_email: admin.email,
      action: "admin.decline_application",
      target_table: "applications",
      target_id: app.id,
    });
    return NextResponse.json({ ok: true, status: "declined" });
  }

  // approve path: create or fetch the host user, set role=host, generate a
  // magic link, create a draft event with host_user_id, email the invite.
  let hostUserId: string | null = null;
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email: app.email,
    email_confirm: true,
    app_metadata: { role: "host" },
  });
  if (createErr) {
    // User likely exists already — look them up via listUsers.
    const { data: existing } = await db.auth.admin.listUsers({ perPage: 200 });
    const found = existing?.users.find(
      (u) => u.email?.toLowerCase() === app.email.toLowerCase(),
    );
    if (found) {
      hostUserId = found.id;
      await db.auth.admin.updateUserById(found.id, {
        app_metadata: { ...found.app_metadata, role: "host" },
      });
    }
  } else if (created?.user) {
    hostUserId = created.user.id;
  }

  if (!hostUserId) {
    return NextResponse.json(
      { error: "user_create_failed" },
      { status: 500 },
    );
  }

  const env = serverEnv();
  const baseUrl = env.APP_BASE_URL.replace(/\/$/, "");
  const { data: link } = await db.auth.admin.generateLink({
    type: "magiclink",
    email: app.email,
    options: { redirectTo: `${baseUrl}/dashboard` },
  });

  // Draft event scaffolds the wall under the new host id.
  const eventCode = codeFromVenue(app.venue);
  await db.from("events").insert({
    code: eventCode,
    couple_display: app.venue,
    couple_html: app.venue.replace(/&/g, "<em>&amp;</em>"),
    when_text: "Date to be set",
    host_user_id: hostUserId,
    status: "draft",
  });

  await db
    .from("applications")
    .update({
      status: "approved",
      reviewed_by: admin.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", app.id);

  if (link?.properties?.action_link) {
    try {
      const tpl = hostInviteEmail({
        venue: app.venue,
        magicLink: link.properties.action_link,
      });
      await sendEmail({
        to: app.email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
    } catch {}
  }

  await db.from("audit_log").insert({
    actor_id: admin.userId,
    actor_email: admin.email,
    action: "admin.approve_application",
    target_table: "applications",
    target_id: app.id,
    meta: { host_user_id: hostUserId, event_code: eventCode },
  });

  return NextResponse.json({
    ok: true,
    status: "approved",
    event_code: eventCode,
  });
}
