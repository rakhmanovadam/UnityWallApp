import { createAdminClient } from "@/lib/supabase/admin";

export type LeadSource = "warm" | "hot" | "request";

// Monotonic rank so we never downgrade a lead's temperature. If a guest sends
// a hot message and then scrolls back into the About section, the follow-up
// warm signal must not clobber the hot record.
const RANK: Record<LeadSource, number> = { warm: 1, hot: 2, request: 2 };

export type UpsertLeadResult = {
  id: string;
  // True when the source-of-record moved up (or the row was just created).
  // Callers use this to gate expensive side effects like the sales-team
  // notification email — a warm→warm re-trigger should be a no-op.
  changed: boolean;
  // The definitive source stored on the row after upsert. Callers should
  // key notifications off this, not off the incoming source (which may have
  // been ignored as a downgrade).
  source: LeadSource;
};

// Idempotent email-keyed upsert. Rules:
//  1. If no row exists for the email, insert with the incoming source.
//  2. If a row exists and the incoming source outranks it, upgrade the
//     source and refresh message / event / utm.
//  3. If the incoming source is the same or lower rank, leave source alone
//     but still fill in any newly-provided message / event / utm (a warm
//     signal that later carries a scrolled-through event id is worth
//     capturing).
//  4. Anonymous submissions (email is null) always insert — we can't dedupe
//     what we can't key on.
export async function upsertLead(opts: {
  source: LeadSource;
  eventId?: string | null;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  message?: string | null;
  utm?: Record<string, string> | null;
}): Promise<UpsertLeadResult> {
  const admin = createAdminClient();
  const email = opts.email?.trim() || null;

  if (!email) {
    const { data, error } = await admin
      .from("leads")
      .insert({
        source: opts.source,
        event_id: opts.eventId ?? null,
        email: null,
        name: opts.name ?? null,
        phone: opts.phone ?? null,
        message: opts.message ?? null,
        utm: opts.utm ?? null,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`lead_insert_failed: ${error?.message}`);
    return { id: data.id as string, changed: true, source: opts.source };
  }

  const { data: existing, error: findErr } = await admin
    .from("leads")
    .select("id, source, message, event_id, utm")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findErr) throw new Error(`lead_lookup_failed: ${findErr.message}`);

  if (!existing) {
    const { data, error } = await admin
      .from("leads")
      .insert({
        source: opts.source,
        event_id: opts.eventId ?? null,
        email,
        name: opts.name ?? null,
        phone: opts.phone ?? null,
        message: opts.message ?? null,
        utm: opts.utm ?? null,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`lead_insert_failed: ${error?.message}`);
    return { id: data.id as string, changed: true, source: opts.source };
  }

  const existingSource = existing.source as LeadSource;
  const upgrading = RANK[opts.source] > RANK[existingSource];
  const nextSource: LeadSource = upgrading ? opts.source : existingSource;

  // Only include columns we're actually changing so we don't overwrite
  // previously-captured message text / event id with nulls from a later
  // signal that didn't include them.
  const patch: Record<string, unknown> = {};
  if (upgrading) patch.source = opts.source;
  if (opts.message && !existing.message) patch.message = opts.message;
  if (opts.eventId && !existing.event_id) patch.event_id = opts.eventId;
  if (opts.utm && !existing.utm) patch.utm = opts.utm;
  if (opts.name) patch.name = opts.name;
  if (opts.phone) patch.phone = opts.phone;

  if (Object.keys(patch).length === 0) {
    return { id: existing.id as string, changed: false, source: existingSource };
  }

  const { error: updateErr } = await admin
    .from("leads")
    .update(patch)
    .eq("id", existing.id);
  if (updateErr) throw new Error(`lead_update_failed: ${updateErr.message}`);

  return {
    id: existing.id as string,
    changed: upgrading,
    source: nextSource,
  };
}
