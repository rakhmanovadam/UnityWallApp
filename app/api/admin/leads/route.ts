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
  let query = db
    .from("leads")
    .select(
      "id, source, email, name, phone, message, status, created_at, event_id",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (source) query = query.eq("source", source);
  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
}
