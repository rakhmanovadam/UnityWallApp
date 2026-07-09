import { createAdminClient } from "@/lib/supabase/admin";
import { PHOTOS_BUCKET, THUMBS_BUCKET } from "@/lib/db/photos";
import { serverEnv } from "@/lib/env";
import { sendEmail, downloadReminderEmail } from "@/lib/email/resend";

const COVERS_BUCKET = "wall-covers";

// Retention lifecycle, driven by app/api/cron/retention on a daily schedule.
//
//   events.delete_after   — when a wall's photos expire (set by the 0003 trigger
//                           from ends_at/created_at + retention_days).
//   reminder_14d_sent_at  — stamped once the 14-day download reminder goes out.
//   reminder_3d_sent_at   — stamped once the 3-day reminder goes out.
//   purged_at             — stamped once photos + storage objects are deleted.
//
// Every sweep is idempotent: reminders gate on their *_sent_at being null, the
// purge gates on purged_at being null, so re-running the cron (or running it
// twice in a day) never double-sends or double-deletes.

type ReminderTier = { days: number; column: "reminder_14d_sent_at" | "reminder_3d_sent_at" };

const REMINDER_TIERS: ReminderTier[] = [
  { days: 14, column: "reminder_14d_sent_at" },
  { days: 3, column: "reminder_3d_sent_at" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Looks up the host's email via the auth admin API. Events store host_user_id,
// not an email, so reminders can't go out without this hop. Returns null when
// the wall has no owner (host_user_id nulled by an account deletion).
async function hostEmail(
  admin: ReturnType<typeof createAdminClient>,
  hostUserId: string | null,
): Promise<string | null> {
  if (!hostUserId) return null;
  const { data, error } = await admin.auth.admin.getUserById(hostUserId);
  if (error || !data?.user?.email) return null;
  return data.user.email;
}

export type ReminderResult = { tier: number; sent: number; failed: number };

// Sends the download reminder for one tier: live walls whose delete_after lands
// inside the tier window and haven't been reminded at this tier yet.
async function runReminderTier(
  admin: ReturnType<typeof createAdminClient>,
  tier: ReminderTier,
  nowMs: number,
): Promise<ReminderResult> {
  const windowEnd = new Date(nowMs + tier.days * DAY_MS).toISOString();
  const nowIso = new Date(nowMs).toISOString();

  const { data: events, error } = await admin
    .from("events")
    .select("id, code, couple_display, host_user_id, delete_after")
    .eq("status", "live")
    .is(tier.column, null)
    .not("delete_after", "is", null)
    .gt("delete_after", nowIso)
    .lte("delete_after", windowEnd);

  if (error || !events) return { tier: tier.days, sent: 0, failed: 0 };

  const env = serverEnv();
  const dashboardUrl = `${env.APP_BASE_URL.replace(/\/$/, "")}/dashboard`;
  let sent = 0;
  let failed = 0;

  for (const ev of events) {
    const to = await hostEmail(admin, ev.host_user_id);
    // Stamp the tier column regardless of whether we found an email so an
    // owner-less wall isn't retried every day forever. Purge still protects
    // the data; the reminder is best-effort.
    if (to) {
      try {
        const tpl = downloadReminderEmail({
          venue: ev.couple_display,
          daysLeft: tier.days,
          deleteOn: formatDate(ev.delete_after as string),
          dashboardUrl,
        });
        await sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text });
        sent++;
      } catch {
        failed++;
      }
    }
    await admin
      .from("events")
      .update({ [tier.column]: nowIso })
      .eq("id", ev.id);
  }

  return { tier: tier.days, sent, failed };
}

export type PurgeResult = {
  eventsPurged: number;
  photosDeleted: number;
  errors: number;
};

// Deletes photos + their storage objects (full-res, thumb, and the wall cover)
// for every wall past its delete_after that hasn't been purged, then archives
// the event and stamps purged_at. Storage removal is best-effort per bucket —
// a failed object removal doesn't block the row deletion, so a purged wall
// never resurfaces even if one object lingers.
async function runPurge(
  admin: ReturnType<typeof createAdminClient>,
  nowMs: number,
): Promise<PurgeResult> {
  const nowIso = new Date(nowMs).toISOString();
  const result: PurgeResult = { eventsPurged: 0, photosDeleted: 0, errors: 0 };

  const { data: events, error } = await admin
    .from("events")
    .select("id, cover_image_path")
    .is("purged_at", null)
    .not("delete_after", "is", null)
    .lte("delete_after", nowIso);

  if (error || !events) return result;

  for (const ev of events) {
    try {
      const { data: photos } = await admin
        .from("photos")
        .select("id, storage_path, thumb_path")
        .eq("event_id", ev.id);

      const fullPaths = (photos ?? [])
        .map((p) => p.storage_path)
        .filter((p): p is string => !!p);
      const thumbPaths = (photos ?? [])
        .map((p) => p.thumb_path)
        .filter((p): p is string => !!p);

      if (fullPaths.length) {
        await admin.storage.from(PHOTOS_BUCKET).remove(fullPaths);
      }
      if (thumbPaths.length) {
        await admin.storage.from(THUMBS_BUCKET).remove(thumbPaths);
      }
      if (ev.cover_image_path) {
        await admin.storage.from(COVERS_BUCKET).remove([ev.cover_image_path]);
      }

      // Delete photo rows explicitly (they'd survive an event archive since
      // we don't delete the event itself). guests/otp stay — they carry the
      // guestbook/consent record, not photo data.
      const { error: delErr } = await admin
        .from("photos")
        .delete()
        .eq("event_id", ev.id);
      if (delErr) {
        result.errors++;
        continue;
      }

      await admin
        .from("events")
        .update({
          status: "archived",
          cover_image_path: null,
          purged_at: nowIso,
        })
        .eq("id", ev.id);

      result.eventsPurged++;
      result.photosDeleted += fullPaths.length;
    } catch {
      result.errors++;
    }
  }

  return result;
}

export type RetentionRunResult = {
  reminders: ReminderResult[];
  purge: PurgeResult;
};

// Entry point for the cron. nowMs is injected so tests/backfills can pin the
// clock; the route passes Date.now().
export async function runRetention(nowMs: number): Promise<RetentionRunResult> {
  const admin = createAdminClient();
  const reminders: ReminderResult[] = [];
  for (const tier of REMINDER_TIERS) {
    reminders.push(await runReminderTier(admin, tier, nowMs));
  }
  const purge = await runPurge(admin, nowMs);
  return { reminders, purge };
}
