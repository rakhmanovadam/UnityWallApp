import { createClient } from "@/lib/supabase/server";

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
};

const COLS =
  "id, code, couple_display, couple_html, when_text, wall_layout, allow_uploads, require_moderation, max_uploads_per_guest, status, welcome_message, cover_image_path";

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
