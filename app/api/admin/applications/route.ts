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
  const status = url.searchParams.get("status");

  const db = createAdminClient();
  let query = db
    .from("applications")
    .select(
      "id, venue, contact, email, phone, city, country, notes, status, created_at, reviewed_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}
