import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminContext } from "@/lib/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { setLeadConverted } from "@/lib/db/leads";

export const runtime = "nodejs";

// The admin master-email table. Backed by the admin_master_emails view
// (migration 0003) which unions leads / guests / photo counts by lowercased
// email. This route is the surface the console table will render off.
//
// Filters:
//   - q            — case-insensitive substring on email or name
//   - temperature  — cold | warm | hot
//   - person_type  — guest | venue_host
//   - converted    — "true" | "false"
//   - limit/offset — plain pagination; view is small enough that
//                    keyset isn't worth the complexity yet.

const Query = z.object({
  q: z.string().max(320).optional(),
  temperature: z.enum(["cold", "warm", "hot"]).optional(),
  person_type: z.enum(["guest", "venue_host"]).optional(),
  converted: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
  // format=csv streams every matching row (filters honoured, pagination
  // ignored) as a downloadable CSV instead of the paged JSON payload.
  format: z.enum(["json", "csv"]).optional(),
});

// Hard ceiling on a single CSV export so a runaway view can't buffer an
// unbounded string into memory. The master-email view is small; this is a
// safety net, not an expected limit.
const CSV_MAX_ROWS = 50_000;

// RFC 4180 field: wrap in quotes and double any embedded quote when the value
// contains a comma, quote, or newline. Nullish becomes empty.
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const admin = await getAdminContext();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = Query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  const {
    q,
    temperature,
    person_type,
    converted,
    limit = 100,
    offset = 0,
    format = "json",
  } = parsed.data;

  const db = createAdminClient();
  let query = db
    .from("admin_master_emails")
    .select("*", { count: "exact" })
    .order("joined_at", { ascending: false, nullsFirst: false });

  if (temperature) query = query.eq("lead_temperature", temperature);
  if (person_type) query = query.eq("person_type", person_type);
  if (converted) query = query.eq("converted", converted === "true");
  if (q) {
    // Two-column ilike via .or so the search box hits both name and email.
    const like = `%${q.replace(/[,%()]/g, "")}%`;
    query = query.or(`email.ilike.${like},name.ilike.${like}`);
  }

  if (format === "csv") {
    const { data, error } = await query.range(0, CSV_MAX_ROWS - 1);
    if (error) {
      return NextResponse.json({ error: "list_failed" }, { status: 500 });
    }
    return csvResponse((data ?? []) as MasterEmailRow[]);
  }

  query = query.range(offset, offset + limit - 1);
  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  // Also surface the top-level funnel counters the plan wants on the
  // dashboard cards. One extra query total for the view's aggregated
  // counts — cheap because the underlying tables are small.
  const [{ count: total }, cold, warm, hot, convertedCount] = await Promise.all(
    [
      { count: count ?? 0 },
      countBySource(db, "cold"),
      countBySource(db, "warm"),
      countBySource(db, "hot"),
      countConverted(db),
    ],
  );

  return NextResponse.json({
    items: data ?? [],
    total,
    counts: {
      cold,
      warm,
      hot,
      converted: convertedCount,
    },
    pagination: { limit, offset },
  });
}

// Manual conversion checkbox. "Converted" strictly means "bought from
// Unitywalls" — nothing sets it automatically anymore (venue approval only
// tags person_type), so this PATCH is the single write path.
const PatchBody = z.object({
  email: z.string().email().max(320),
  converted: z.boolean(),
});

export async function PATCH(request: Request) {
  const admin = await getAdminContext();
  if (!admin) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  try {
    await setLeadConverted(email, parsed.data.converted);
  } catch {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  const db = createAdminClient();
  await db.from("audit_log").insert({
    actor_id: admin.userId,
    actor_email: admin.email,
    action: "admin.set_converted",
    target_table: "leads",
    target_id: null,
    meta: { email, converted: parsed.data.converted },
  });

  return NextResponse.json({ ok: true });
}

// Shape of a row from the admin_master_emails view — mirrors MasterRow on the
// client. Only used to type the CSV serializer.
type MasterEmailRow = {
  email: string;
  name: string | null;
  lead_temperature: string;
  person_type: string;
  converted: boolean;
  converted_at: string | null;
  marketing_opt_in: boolean;
  joined_at: string | null;
  photos_uploaded: number;
  verified_events: number;
};

// Ordered columns for the export. Header label + how to pull the value.
const CSV_COLUMNS: Array<{
  header: string;
  get: (r: MasterEmailRow) => unknown;
}> = [
  { header: "email", get: (r) => r.email },
  { header: "name", get: (r) => r.name },
  { header: "lead_temperature", get: (r) => r.lead_temperature },
  { header: "person_type", get: (r) => r.person_type },
  { header: "converted", get: (r) => (r.converted ? "yes" : "no") },
  { header: "converted_at", get: (r) => r.converted_at },
  { header: "marketing_opt_in", get: (r) => (r.marketing_opt_in ? "yes" : "no") },
  { header: "joined_at", get: (r) => r.joined_at },
  { header: "photos_uploaded", get: (r) => r.photos_uploaded },
  { header: "verified_events", get: (r) => r.verified_events },
];

function csvResponse(rows: MasterEmailRow[]): Response {
  const lines = [CSV_COLUMNS.map((c) => c.header).join(",")];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((c) => csvField(c.get(row))).join(","));
  }
  // Leading BOM so Excel opens UTF-8 names correctly.
  const body = "﻿" + lines.join("\r\n") + "\r\n";
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="unitywall-emails.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

async function countBySource(
  db: ReturnType<typeof createAdminClient>,
  temperature: "cold" | "warm" | "hot",
) {
  const { count } = await db
    .from("admin_master_emails")
    .select("email", { count: "exact", head: true })
    .eq("lead_temperature", temperature);
  return count ?? 0;
}

async function countConverted(db: ReturnType<typeof createAdminClient>) {
  const { count } = await db
    .from("admin_master_emails")
    .select("email", { count: "exact", head: true })
    .eq("converted", true);
  return count ?? 0;
}
