import { createAdminClient } from "@/lib/supabase/admin";

export async function insertApplication(opts: {
  venue: string;
  contact: string;
  email: string;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  notes?: string | null;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("applications")
    .insert({
      venue: opts.venue,
      contact: opts.contact,
      email: opts.email,
      phone: opts.phone ?? null,
      city: opts.city ?? null,
      country: opts.country ?? null,
      notes: opts.notes ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`application_insert_failed: ${error?.message}`);
  }
  return data.id as string;
}
