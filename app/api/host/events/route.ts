import { NextResponse } from "next/server";
import { getHostContext } from "@/lib/host-session";

export const runtime = "nodejs";

export async function GET() {
  const ctx = await getHostContext();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ events: ctx.events, email: ctx.email });
}
