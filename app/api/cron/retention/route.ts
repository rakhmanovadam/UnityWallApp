import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { runRetention } from "@/lib/db/retention";

export const runtime = "nodejs";
// Purging a large wall means downloading nothing but issuing many storage
// deletes; reminders send a handful of emails. 300s is the safe ceiling.
export const maxDuration = 300;
// Never cache — this mutates.
export const dynamic = "force-dynamic";

// Daily retention sweep (scheduled in vercel.json). Sends 14d/3d download
// reminders and purges photos for walls past their delete_after date.
//
// Auth: Vercel Cron attaches `Authorization: Bearer <CRON_SECRET>` when the
// project has CRON_SECRET set. We require it in production. If CRON_SECRET is
// unset (local/preview) the endpoint refuses rather than running unauthenticated
// against a real service-role client.
export async function GET(request: Request) {
  const env = serverEnv();
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runRetention(Date.now());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "retention_failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
