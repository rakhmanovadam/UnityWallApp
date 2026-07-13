#!/usr/bin/env node
// Stress / capacity test for a UnityWall guest wall.
//
// Creates a clearly-labelled demo event (code STRESS-DEMO), floods it with N
// approved photo rows that all point at one tiny uploaded thumbnail (so the
// real wall query + render path is exercised without N real uploads), then
// measures: bulk-insert throughput, the wall's first-page + paginated list
// query latency, and concurrent single-insert latency.
//
// Everything it creates is namespaced to the demo event and removable with
// --cleanup. Nothing touches real venues.
//
// Usage:
//   node scripts/stress-flood.mjs --n=3000 --concurrency=50
//   node scripts/stress-flood.mjs --cleanup
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ---- env ----------------------------------------------------------------
function loadEnv() {
  const out = {};
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // fall through to process.env
  }
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || out.NEXT_PUBLIC_SUPABASE_URL,
    key:
      process.env.SUPABASE_SERVICE_ROLE_KEY || out.SUPABASE_SERVICE_ROLE_KEY,
  };
}

const { url, key } = loadEnv();
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);

const CODE = "STRESS-DEMO";
const N = Number(args.n) || 3000;
const CONC = Number(args.concurrency) || 50;
const THUMB_KEY = "stress-demo/thumb.jpg";
const FULL_KEY = "stress-demo/full.jpg";

// A valid 1x1 white JPEG.
const JPEG_1x1 = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

async function findDemoEvent() {
  const { data } = await db
    .from("events")
    .select("id")
    .eq("code", CODE)
    .maybeSingle();
  return data?.id ?? null;
}

async function cleanup() {
  const id = await findDemoEvent();
  if (!id) {
    console.log("No demo event to clean up.");
    return;
  }
  await db.from("photos").delete().eq("event_id", id);
  await db.from("guests").delete().eq("event_id", id);
  await db.from("events").delete().eq("id", id);
  await db.storage.from("wall-thumbs").remove([THUMB_KEY]).catch(() => {});
  await db.storage.from("wall-photos").remove([FULL_KEY]).catch(() => {});
  console.log(`Cleaned up demo event ${id} and all its rows/objects.`);
}

async function setup() {
  let id = await findDemoEvent();
  if (!id) {
    // Reuse any existing user as the host (host_user_id is a FK to auth.users).
    const { data: users } = await db.auth.admin.listUsers({ perPage: 1 });
    const host = users?.users?.[0]?.id ?? null;
    const { data, error } = await db
      .from("events")
      .insert({
        code: CODE,
        couple_display: "Stress Demo",
        couple_html: "Stress Demo",
        when_text: "Load test",
        status: "live",
        allow_uploads: true,
        require_moderation: false,
        host_user_id: host,
      })
      .select("id")
      .single();
    if (error) throw new Error(`event insert: ${error.message}`);
    id = data.id;
  }
  // Upload the shared demo thumb + full once.
  await db.storage
    .from("wall-thumbs")
    .upload(THUMB_KEY, JPEG_1x1, { contentType: "image/jpeg", upsert: true });
  await db.storage
    .from("wall-photos")
    .upload(FULL_KEY, JPEG_1x1, { contentType: "image/jpeg", upsert: true });

  // One demo guest to satisfy the photos.guest_id FK.
  let guestId;
  const { data: g } = await db
    .from("guests")
    .select("id")
    .eq("event_id", id)
    .limit(1)
    .maybeSingle();
  if (g) {
    guestId = g.id;
  } else {
    const { data: ng, error } = await db
      .from("guests")
      .insert({
        event_id: id,
        email: "stress-demo@example.com",
        verified_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(`guest insert: ${error.message}`);
    guestId = ng.id;
  }
  return { id, guestId };
}

const BASE_TS = Date.now();
function photoRow(eventId, guestId, i) {
  return {
    event_id: eventId,
    guest_id: guestId,
    storage_path: FULL_KEY,
    thumb_path: THUMB_KEY,
    status: "approved",
    width: 1,
    height: 1,
    bytes: JPEG_1x1.length,
    content_type: "image/jpeg",
    caption: `demo #${i}`,
    // Stagger so cursor pagination walks real pages (real uploads differ by ms).
    uploaded_at: new Date(BASE_TS - i * 1000).toISOString(),
  };
}

async function flood(eventId, guestId) {
  const CHUNK = 500;
  const t0 = Date.now();
  let inserted = 0;
  for (let start = 0; start < N; start += CHUNK) {
    const rows = [];
    for (let i = start; i < Math.min(start + CHUNK, N); i++) {
      rows.push(photoRow(eventId, guestId, i));
    }
    const { error } = await db.from("photos").insert(rows);
    if (error) throw new Error(`photo insert: ${error.message}`);
    inserted += rows.length;
    process.stdout.write(`\r  inserted ${inserted}/${N}`);
  }
  const secs = (Date.now() - t0) / 1000;
  console.log(
    `\n  ${inserted} rows in ${secs.toFixed(1)}s (${Math.round(
      inserted / secs,
    )} rows/s)`,
  );
}

async function measureListQuery(eventId) {
  // Mirrors listApprovedPhotos: page of 30, newest first, cursor on uploaded_at.
  let cursor = null;
  for (let page = 1; page <= 5; page++) {
    const t0 = Date.now();
    let q = db
      .from("photos")
      .select("id, caption, width, height, uploaded_at, thumb_path, status")
      .eq("event_id", eventId)
      .eq("status", "approved")
      .order("uploaded_at", { ascending: false })
      .limit(31);
    if (cursor) q = q.lt("uploaded_at", cursor);
    const { data, error } = await q;
    const ms = Date.now() - t0;
    if (error) {
      console.log(`  page ${page}: ERROR ${error.message}`);
      break;
    }
    const rows = data.slice(0, 30);
    cursor = rows.length ? rows[rows.length - 1].uploaded_at : null;
    console.log(`  page ${page}: ${rows.length} rows in ${ms}ms`);
    if (!cursor) break;
  }
}

async function measureConcurrency(eventId, guestId) {
  const t0 = Date.now();
  const jobs = Array.from({ length: CONC }, (_, i) =>
    db.from("photos").insert(photoRow(eventId, guestId, 100000 + i)),
  );
  const res = await Promise.all(jobs);
  const secs = (Date.now() - t0) / 1000;
  const fails = res.filter((r) => r.error).length;
  console.log(
    `  ${CONC} concurrent inserts in ${secs.toFixed(2)}s, ${fails} failures`,
  );
}

async function main() {
  if (args.cleanup) {
    await cleanup();
    return;
  }
  console.log(`Flooding demo wall "${CODE}" with ${N} photos…`);
  const { id, guestId } = await setup();
  console.log(`  event ${id}`);
  await flood(id, guestId);
  const { count } = await db
    .from("photos")
    .select("id", { count: "exact", head: true })
    .eq("event_id", id);
  console.log(`\nWall now holds ${count} photos. Timing list query:`);
  await measureListQuery(id);
  console.log(`\nConcurrent-insert burst:`);
  await measureConcurrency(id, guestId);
  console.log(
    `\nDone. Load the wall at /join/${CODE} to eyeball render, then run`,
  );
  console.log(`  node scripts/stress-flood.mjs --cleanup`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
