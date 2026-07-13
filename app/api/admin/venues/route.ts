import { NextResponse } from "next/server";
import { getAdminContext } from "@/lib/admin-session";
import { listAdminVenues } from "@/lib/db/admin-venues";

export const runtime = "nodejs";

// Admin-only: every venue with photo counts + host email + a signed cover
// preview. Powers the "Venues" section of the console.
export async function GET() {
  const admin = await getAdminContext();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const items = await listAdminVenues();
  return NextResponse.json({ items });
}
