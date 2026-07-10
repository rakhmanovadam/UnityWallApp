import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminContext } from "@/lib/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminInviteEmail, sendEmail } from "@/lib/email/resend";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";

// Invitation-only admin access: an existing admin submits an email, we
// create (or promote) that account with app_metadata.role='admin' and send
// a magic-link invite through Resend. The /admin gate keys off the role, so
// there is no other path to the console.

const Body = z.object({
  email: z.string().email().max(320),
});

export async function POST(request: Request) {
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

  const email = parsed.data.email.trim().toLowerCase();
  const db = createAdminClient();

  // Create the user pre-confirmed with the admin role; if the address
  // already has an account (host or admin), promote it in place instead.
  let userId: string | null = null;
  let alreadyAdmin = false;
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { role: "admin" },
  });
  if (createErr) {
    const { data: existing } = await db.auth.admin.listUsers({ perPage: 200 });
    const found = existing?.users.find(
      (u) => u.email?.toLowerCase() === email,
    );
    if (found) {
      userId = found.id;
      alreadyAdmin =
        (found.app_metadata as { role?: string } | undefined)?.role ===
        "admin";
      if (!alreadyAdmin) {
        const { error: updateErr } = await db.auth.admin.updateUserById(
          found.id,
          { app_metadata: { ...found.app_metadata, role: "admin" } },
        );
        if (updateErr) {
          return NextResponse.json(
            { error: "promote_failed" },
            { status: 500 },
          );
        }
      }
    }
  } else if (created?.user) {
    userId = created.user.id;
  }

  if (!userId) {
    return NextResponse.json({ error: "user_create_failed" }, { status: 500 });
  }

  // Same delivery path as host invites: generate the token_hash server-side
  // and route through our /auth/callback (Supabase's raw action_link bounces
  // to the misconfigured Site URL on expiry/pre-consume).
  const env = serverEnv();
  const baseUrl = env.APP_BASE_URL.replace(/\/$/, "");
  let emailStatus: "sent" | "failed" = "failed";
  try {
    const { data: link, error: linkErr } = await db.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr || !link?.properties?.hashed_token) throw new Error("no_link");
    const inviteLink =
      `${baseUrl}/auth/callback` +
      `?token_hash=${encodeURIComponent(link.properties.hashed_token)}` +
      `&type=${encodeURIComponent(link.properties.verification_type)}` +
      `&next=${encodeURIComponent("/admin")}`;
    const tpl = adminInviteEmail({
      magicLink: inviteLink,
      invitedBy: admin.email,
    });
    await sendEmail({
      to: email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
    emailStatus = "sent";
  } catch {
    emailStatus = "failed";
  }

  await db.from("audit_log").insert({
    actor_id: admin.userId,
    actor_email: admin.email,
    action: "admin.invite_admin",
    target_table: "auth.users",
    target_id: userId,
    meta: { email, already_admin: alreadyAdmin, email_status: emailStatus },
  });

  if (emailStatus === "failed") {
    // The role is already granted; surface the delivery failure so the
    // inviter can retry rather than assuming the invite landed.
    return NextResponse.json({ error: "email_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, already_admin: alreadyAdmin });
}
