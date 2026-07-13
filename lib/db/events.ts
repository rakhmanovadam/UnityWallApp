import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type EventRow = {
  id: string;
  code: string;
  couple_display: string;
  couple_html: string;
  when_text: string;
  wall_layout: string;
  allow_uploads: boolean;
  require_moderation: boolean;
  max_uploads_per_guest: number;
  status: "draft" | "live" | "archived";
  welcome_message: string | null;
  cover_image_path: string | null;
  retention_days: number;
  delete_after: string | null;
  theme_primary: string | null;
  theme_accent: string | null;
  theme_bg: string | null;
  theme_font: string | null;
};

const COLS =
  "id, code, couple_display, couple_html, when_text, wall_layout, allow_uploads, require_moderation, max_uploads_per_guest, status, welcome_message, cover_image_path, retention_days, delete_after, theme_primary, theme_accent, theme_bg, theme_font";

export function normalizeCode(input: string) {
  return input.trim().toUpperCase().replace(/\s+/g, "-");
}

// Fetch a live event by code via the anon-keyed cookie client. RLS guarantees
// drafts and archived events return null — no need to filter here.
export async function getLiveEventByCode(code: string): Promise<EventRow | null> {
  const supabase = await createClient();
  const normalized = normalizeCode(code);
  const { data, error } = await supabase
    .from("events")
    .select(COLS)
    .eq("code", normalized)
    .maybeSingle<EventRow>();
  if (error) return null;
  return data ?? null;
}

// Signed display URL for a host-uploaded venue banner (wall-covers bucket is
// private, same as photos/thumbs). 1h expiry matches the thumb signer.
export async function signedCoverUrl(
  path: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from("wall-covers")
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
