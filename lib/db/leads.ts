import { createAdminClient } from "@/lib/supabase/admin";

export type LeadSource = "warm" | "hot" | "request";

export async function insertLead(opts: {
  source: LeadSource;
  eventId?: string | null;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  message?: string | null;
  utm?: Record<string, string> | null;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("leads")
    .insert({
      source: opts.source,
      event_id: opts.eventId ?? null,
      email: opts.email ?? null,
      name: opts.name ?? null,
      phone: opts.phone ?? null,
      message: opts.message ?? null,
      utm: opts.utm ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`lead_insert_failed: ${error?.message}`);
  return data.id as string;
}
