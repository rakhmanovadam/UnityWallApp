import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminContext } from "@/lib/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminInviteEmail, sendEmail } from "@/lib/email/resend";
import { serverEnv } from "@/lib/env";
import { isSuperAdmin } from "@/lib/admins";

export const runtime = "nodejs";

// Invitation-only admin access: an existing admin submits an email, we
// create (or promote) that account with app_metadata.role='admin' and send
// a magic-link invite through Resend. The /admin gate keys off the role, so
// there is no other path to the console.

const Body = z.object({
  email: z.string().email().max(320),
});

// Roster of everyone who currently holds admin role — rendered under the
// invite form so an admin can see who else has console access. Walks the
// paginated auth admin listing (capped) and filters on app_metadata.role.
export async function GET() {
  const admin = await getAdminContext();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();
  const admins: {
    email: string;
    created_at: string;
    is_you: boolean;
    is_super: boolean;
  }[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error || !data) break;
    for (const u of data.users) {
      const role = (u.app_metadata as { role?: string } | undefined)?.role;
      if (role === "admin" && u.email) {
        admins.push({
          email: u.email,
          created_at: u.created_at ?? "",
          is_you: u.id === admin.userId,
          is_super: isSuperAdmin(u.email),
        });
      }
    }
    if (data.users.length < 200) break;
  }
  // Super-admins first, then alphabetical — the two owners pin to the top.
  admins.sort((a, b) => {
    if (a.is_super !== b.is_super) return a.is_super ? -1 : 1;
    return a.email.localeCompare(b.email);
  });
  // viewer_is_super gates the delete controls client-side; the DELETE handler
  // re-checks server-side so the flag is purely cosmetic.
  return NextResponse.json({ admins, viewer_is_super: isSuperAdmin(admin.email) });
}

// Remove an admin's console access. Only the two super-admins may do this, and
// super-admins themselves can't be removed through the UI. Strips the admin
// role rather than deleting the auth user (they may also be a host).
const DeleteBody = z.object({
  email: z.string().email().max(320),
});

export async function DELETE(request: Request) {
  const admin = await getAdminContext();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSuperAdmin(admin.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = DeleteBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const email = parsed.data.email.trim().toLowerCase();

  // The two owners are permanent — refuse to strip either, even from the other.
  if (isSuperAdmin(email)) {
    return NextResponse.json({ error: "cannot_remove_super" }, { status: 400 });
  }

  const db = createAdminClient();
  const { data: existing } = await db.auth.admin.listUsers({ perPage: 200 });
  const found = existing?.users.find((u) => u.email?.toLowerCase() === email);
  if (!found) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Drop the role key entirely; keep any other app_metadata intact.
  const meta = { ...(found.app_metadata as Record<string, unknown>) };
  delete meta.role;
  const { error: updateErr } = await db.auth.admin.updateUserById(found.id, {
    app_metadata: { ...meta, role: null },
  });
  if (updateErr) {
    return NextResponse.json({ error: "revoke_failed" }, { status: 500 });
  }

  await db.from("audit_log").insert({
    actor_id: admin.userId,
    actor_email: admin.email,
    action: "admin.remove_admin",
    target_table: "auth.users",
    target_id: found.id,
    meta: { email },
  });

  return NextResponse.json({ ok: true });
}

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
