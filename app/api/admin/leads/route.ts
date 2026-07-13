import { NextResponse } from "next/server";
import { getAdminContext } from "@/lib/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const admin = await getAdminContext();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const source = url.searchParams.get("source");

  const db = createAdminClient();
  // Join the originating event so the console can attribute each lead to the
  // exact wall it came from — the differentiator when several events run on the
  // same day. events(...) is the FK embed on leads.event_id; it's null for
  // anonymous / application-sourced leads that carried no event.
  let query = db
    .from("leads")
    .select(
      "id, source, email, name, phone, message, status, created_at, event_id, events(code, couple_display)",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (source) query = query.eq("source", source);
  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  type Row = {
    id: string;
    source: string;
    email: string | null;
    name: string | null;
    phone: string | null;
    message: string | null;
    status: string | null;
    created_at: string;
    event_id: string | null;
    events: { code: string; couple_display: string } | null;
  };
  const items = ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    source: r.source,
    email: r.email,
    name: r.name,
    phone: r.phone,
    message: r.message,
    status: r.status,
    created_at: r.created_at,
    event_id: r.event_id,
    event_code: r.events?.code ?? null,
    event_name: r.events?.couple_display ?? null,
  }));

  return NextResponse.json({ items });
}
