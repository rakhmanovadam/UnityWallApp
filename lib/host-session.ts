import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type HostContext = {
  userId: string;
  email: string;
  events: Array<{
    id: string;
    code: string;
    couple_display: string;
    when_text: string;
    status: "draft" | "live" | "archived";
    wall_layout: string;
    allow_uploads: boolean;
    require_moderation: boolean;
    max_uploads_per_guest: number;
    welcome_message: string | null;
    cover_image_path: string | null;
    retention_days: number;
    delete_after: string | null;
    theme_primary: string | null;
    theme_accent: string | null;
    theme_bg: string | null;
    theme_font: string | null;
  }>;
};

// Returns the host context if the caller is signed in. Hosts are identified
// by ownership of at least one events row — no separate "role" check needed.
export async function getHostContext(): Promise<HostContext | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  // Service-role lookup so we can include drafts and archived events the
  // host owns (RLS would hide drafts otherwise).
  const admin = createAdminClient();
  const { data: events } = await admin
    .from("events")
    .select(
      "id, code, couple_display, when_text, status, wall_layout, allow_uploads, require_moderation, max_uploads_per_guest, welcome_message, cover_image_path, retention_days, delete_after, theme_primary, theme_accent, theme_bg, theme_font",
    )
    .eq("host_user_id", auth.user.id)
    .order("created_at", { ascending: false });

  return {
    userId: auth.user.id,
    email: auth.user.email ?? "",
    events: events ?? [],
  };
}

export async function requireOwnedEvent(eventId: string) {
  const ctx = await getHostContext();
  if (!ctx) return null;
  const event = ctx.events.find((e) => e.id === eventId);
  if (!event) return null;
  return { ctx, event };
}
