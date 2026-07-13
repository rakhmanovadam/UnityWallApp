import { createAdminClient } from "@/lib/supabase/admin";
import { signedThumbUrl } from "@/lib/db/photos";

// Admin-only venue oversight. Unlike the host paths these deliberately skip
// ownership gates — an admin (role checked upstream in the route via
// getAdminContext) can see and act on every event and photo. RLS already
// grants admins full access; these helpers use the service-role client to
// stay consistent with the rest of the admin surface.

export type AdminVenueSummary = {
  id: string;
  code: string;
  couple_display: string;
  when_text: string;
  status: "draft" | "live" | "archived";
  host_email: string | null;
  cover_url: string | null;
  photos_total: number;
  photos_pending: number;
  photos_approved: number;
};

export async function listAdminVenues(): Promise<AdminVenueSummary[]> {
  const admin = createAdminClient();

  const { data: events } = await admin
    .from("events")
    .select(
      "id, code, couple_display, when_text, status, host_user_id, cover_image_path",
    )
    .order("created_at", { ascending: false });
  if (!events || events.length === 0) return [];

  // Tally photo status per event in one pass. Small columns, admin-only.
  const { data: photos } = await admin
    .from("photos")
    .select("event_id, status");
  const tally = new Map<
    string,
    { total: number; pending: number; approved: number }
  >();
  for (const p of photos ?? []) {
    const t = tally.get(p.event_id) ?? { total: 0, pending: 0, approved: 0 };
    t.total += 1;
    if (p.status === "pending") t.pending += 1;
    if (p.status === "approved") t.approved += 1;
    tally.set(p.event_id, t);
  }

  // Resolve host emails (one lookup per unique host).
  const hostIds = [...new Set(events.map((e) => e.host_user_id).filter(Boolean))];
  const emailById = new Map<string, string>();
  await Promise.all(
    hostIds.map(async (id) => {
      try {
        const { data } = await admin.auth.admin.getUserById(id as string);
        if (data.user?.email) emailById.set(id as string, data.user.email);
      } catch {
        // Non-fatal — venue still lists without a host email.
      }
    }),
  );

  return Promise.all(
    events.map(async (e) => {
      const t = tally.get(e.id) ?? { total: 0, pending: 0, approved: 0 };
      let coverUrl: string | null = null;
      if (e.cover_image_path) {
        try {
          const { data } = await admin.storage
            .from("wall-covers")
            .createSignedUrl(e.cover_image_path, 3600);
          coverUrl = data?.signedUrl ?? null;
        } catch {
          coverUrl = null;
        }
      }
      return {
        id: e.id,
        code: e.code,
        couple_display: e.couple_display,
        when_text: e.when_text,
        status: e.status,
        host_email: e.host_user_id
          ? emailById.get(e.host_user_id) ?? null
          : null,
        cover_url: coverUrl,
        photos_total: t.total,
        photos_pending: t.pending,
        photos_approved: t.approved,
      } satisfies AdminVenueSummary;
    }),
  );
}

export type AdminVenuePhoto = {
  id: string;
  thumb_url: string | null;
  status: string;
  caption: string | null;
  uploaded_at: string;
};

export type AdminVenueDetail = {
  id: string;
  code: string;
  couple_display: string;
  when_text: string;
  status: string;
  wall_layout: string;
  allow_uploads: boolean;
  require_moderation: boolean;
  max_uploads_per_guest: number;
  welcome_message: string | null;
  theme_primary: string | null;
  theme_accent: string | null;
  theme_bg: string | null;
  theme_font: string | null;
  photos: AdminVenuePhoto[];
};

export async function getAdminVenueDetail(
  eventId: string,
): Promise<AdminVenueDetail | null> {
  const admin = createAdminClient();
  const { data: e } = await admin
    .from("events")
    .select(
      "id, code, couple_display, when_text, status, wall_layout, allow_uploads, require_moderation, max_uploads_per_guest, welcome_message, theme_primary, theme_accent, theme_bg, theme_font",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (!e) return null;

  // Every photo regardless of status — admin reviews pending + can pull back
  // an already-approved one. Cap at 300 newest so a flooded wall stays bounded.
  const { data: rows } = await admin
    .from("photos")
    .select("id, thumb_path, status, caption, uploaded_at")
    .eq("event_id", eventId)
    .order("uploaded_at", { ascending: false })
    .limit(300);

  const photos = await Promise.all(
    (rows ?? []).map(async (r) => {
      let thumb: string | null = null;
      if (r.thumb_path) {
        try {
          thumb = await signedThumbUrl(r.thumb_path, 3600);
        } catch {
          thumb = null;
        }
      }
      return {
        id: r.id,
        thumb_url: thumb,
        status: r.status,
        caption: r.caption,
        uploaded_at: r.uploaded_at,
      } satisfies AdminVenuePhoto;
    }),
  );

  return { ...e, photos } as AdminVenueDetail;
}

export async function setPhotoStatusAdmin(
  photoId: string,
  status: "approved" | "rejected",
): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("photos")
    .update({ status })
    .eq("id", photoId);
  return !error;
}
