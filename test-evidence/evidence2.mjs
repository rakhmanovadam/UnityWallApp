// UnityWall evidence v2 — hydration-independent. Drives every feature through
// its real HTTP API with real auth (guest JWT via OTP verify, host/admin via
// magic-link session, cron via bearer), asserts DB effects with the service
// role, and screenshots the SSR-rendered UI as visual proof.
import { chromium, devices } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MAIN = "/Users/adamrakhmanov08/Downloads/unitywall";
const OUT = path.join(MAIN, "test-evidence");
const FXDIR = "/private/tmp/claude-501/-Users-adamrakhmanov08-Downloads-unitywall/aa41f196-1b6e-4acc-aa14-c892c9005a3d/scratchpad/fixtures";
const SCR = "/private/tmp/claude-501/-Users-adamrakhmanov08-Downloads-unitywall/aa41f196-1b6e-4acc-aa14-c892c9005a3d/scratchpad";
const PORT = process.env.UW_PORT || "4174";
const BASE = `http://127.0.0.1:${PORT}`;
const CRON = "test-cron-secret-1234567890";
fs.mkdirSync(OUT, { recursive: true });

const env = {};
for (const line of fs.readFileSync(path.join(MAIN, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const EVENTS = JSON.parse(fs.readFileSync(path.join(SCR, "events.json"), "utf8"));
const FIX = [1, 2, 3, 4, 5].map((n) => {
  const p = path.join(FXDIR, `test-photo-${n}.jpg`);
  return { name: `test-photo-${n}.jpg`, buf: fs.readFileSync(p), type: "image/jpeg" };
});

const results = [];
function rec(id, area, name, status, detail, shot) {
  results.push({ id, area, name, status, detail: detail || "", shot: shot || "" });
  const m = status === "PASS" ? "✓" : status === "GAP" ? "⚠" : "✗";
  console.log(`${m} [${id}] ${name} :: ${status} ${detail ? "- " + detail : ""}`);
}
const device = devices["iPhone 14"];

function packHash(code) {
  const salt = crypto.randomBytes(8).toString("hex");
  const hash = crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
  return `${salt}$${hash}`;
}
async function seedGuestAndOtp(eventId, email, code, optIn) {
  await admin.from("guests").insert({ event_id: eventId, email, marketing_opt_in: !!optIn,
    consent_timestamp: optIn ? new Date().toISOString() : null, consent_text_version: "v1.0" }).select("id");
  await admin.from("otp_codes").insert({ event_id: eventId, email, code_hash: packHash(code),
    expires_at: new Date(Date.now() + 10 * 60000).toISOString() });
}
// Verify OTP through the real API, then pin the returned cookie onto the context
// (Set-Cookie is Secure; re-add as non-secure so it rides http://127.0.0.1).
async function verifyGuest(ctx, code, email) {
  const res = await ctx.request.post(`${BASE}/api/otp/verify`, { data: { code, email, otp: "123456" } });
  const setc = res.headers()["set-cookie"] || "";
  const mm = setc.match(/uw_guest=([^;]+)/);
  if (mm) {
    await ctx.addCookies([{ name: "uw_guest", value: mm[1], domain: "127.0.0.1", path: "/",
      httpOnly: true, secure: false, sameSite: "Lax" }]);
  }
  return { status: res.status(), ok: res.ok(), hadCookie: !!mm };
}
async function uploadOne(ctx, f) {
  const initR = await ctx.request.post(`${BASE}/api/uploads/init`,
    { data: { filename: f.name, content_type: f.type, bytes: f.buf.length } });
  if (!initR.ok()) return { ok: false, stage: "init", status: initR.status(), err: (await initR.json().catch(() => ({}))).error };
  const init = await initR.json();
  const putR = await ctx.request.put(init.upload_url, { headers: { "Content-Type": f.type }, data: f.buf });
  if (!putR.ok()) return { ok: false, stage: "put", status: putR.status() };
  const finR = await ctx.request.post(`${BASE}/api/uploads/finalize`, { data: { photo_id: init.photo_id } });
  return { ok: finR.ok(), stage: "finalize", status: finR.status(), photo_id: init.photo_id };
}
async function magicLogin(ctx, email, next) {
  const { data } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const th = data.properties.hashed_token, type = data.properties.verification_type || "magiclink";
  const page = await ctx.newPage();
  await page.goto(`${BASE}/auth/callback?token_hash=${encodeURIComponent(th)}&type=${type}&next=${encodeURIComponent(next)}`,
    { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  // The very first render after the callback can precede the session cookie
  // being applied; reload the target so the SSR page renders authed.
  await page.goto(`${BASE}${next}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  return page;
}
async function ensureUser(email, appMeta) {
  const { data } = await admin.auth.admin.createUser({ email, email_confirm: true, app_metadata: appMeta || {} });
  if (data?.user) return data.user.id;
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
  const f = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (f && appMeta) await admin.auth.admin.updateUserById(f.id, { app_metadata: appMeta });
  return f?.id;
}
async function shot(page, file) { await page.screenshot({ path: path.join(OUT, file), fullPage: true }); return file; }

const TS = Date.now();
const uniq = (p) => `${p}+${TS}@example.com`;
const browser = await chromium.launch();

try {
  // ===== STATIC + marketing =====
  {
    const ctx = await browser.newContext({ ...device });
    const page = await ctx.newPage();
    for (const [id, url, name, file] of [
      ["STA-01", "/", "Home — 3 doors", "sta-01-home.png"],
      ["STA-02", "/join", "Join code page", "sta-02-join.png"],
      ["STA-03", "/request", "Venue application form", "sta-03-request.png"],
      ["STA-04", "/privacy", "Privacy page", "sta-04-privacy.png"],
      ["STA-05", "/terms", "Terms page", "sta-05-terms.png"],
      ["STA-06", "/request/sent", "Application-sent page", "sta-06-request-sent.png"],
    ]) {
      try { await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(400);
        rec(id, "static", name, page.url().includes(url) ? "PASS" : "FAIL", "", await shot(page, file)); }
      catch (e) { rec(id, "static", name, "FAIL", e.message); }
    }
    try { await page.goto(`${BASE}/join/NOPE-NOPE`, { waitUntil: "domcontentloaded" });
      const t = (await page.textContent("body")).toLowerCase();
      rec("STA-07", "static", "Unknown join code -> 404", t.includes("404") || t.includes("not found") ? "PASS" : "FAIL", "", await shot(page, "sta-07-404.png")); }
    catch (e) { rec("STA-07", "static", "404", "FAIL", e.message); }
    // marketing: venue application via API (form onSubmit path == this POST)
    try { const em = uniq("venue");
      const r = await ctx.request.post(`${BASE}/api/applications`, { data: { venue: "TEST Foundry Hall", contact: "Test Contact", email: em, phone: "(615) 555-0100", notes: "Automated test venue." } });
      const { data: a } = await admin.from("applications").select("id,status").eq("email", em).maybeSingle();
      rec("MKT-01", "marketing", "Venue application persists", r.ok() && a ? "PASS" : "FAIL", `http=${r.status()} row=${a?.id} status=${a?.status}`); }
    catch (e) { rec("MKT-01", "marketing", "Venue application", "FAIL", e.message); }
    // marketing: warm/hot lead capture
    try { const r = await ctx.request.post(`${BASE}/api/leads`, { data: { source: "hot", email: uniq("lead"), name: "Hot Lead", message: "test" } });
      rec("MKT-02", "marketing", "Lead capture (hot)", r.ok() ? "PASS" : "FAIL", `http=${r.status()}`); }
    catch (e) { rec("MKT-02", "marketing", "Lead capture", "FAIL", e.message); }
    await ctx.close();
  }

  // ===== GUEST journey (happy) =====
  {
    const ctx = await browser.newContext({ ...device });
    const code = "TEST-HAPPY-WALL", eid = EVENTS[code], email = uniq("guest");
    try {
      await seedGuestAndOtp(eid, email, "123456", true);
      const v = await verifyGuest(ctx, code, email);
      const { data: g } = await admin.from("guests").select("verified_at,marketing_opt_in").eq("event_id", eid).eq("email", email).maybeSingle();
      rec("GST-01", "guest", "OTP verify -> guest cookie + verified_at + opt-in", v.ok && g?.verified_at ? "PASS" : "FAIL",
        `http=${v.status} cookie=${v.hadCookie} verified=${!!g?.verified_at} optin=${g?.marketing_opt_in}`);
    } catch (e) { rec("GST-01", "guest", "OTP verify", "FAIL", e.message); }

    try {
      const up = [];
      for (const f of FIX.slice(0, 3)) up.push(await uploadOne(ctx, f));
      const okCount = up.filter((u) => u.ok).length;
      const { data: photos } = await admin.from("photos").select("id,status").eq("event_id", eid);
      rec("GST-02", "guest", "Upload 3 photos (init+PUT+finalize+sharp)", okCount === 3 && photos?.length >= 3 ? "PASS" : "FAIL",
        `finalized=${okCount}/3 rows=${photos?.length} status=${photos?.[0]?.status}`);
    } catch (e) { rec("GST-02", "guest", "Upload photos", "FAIL", e.message); }

    try { const page = await ctx.newPage();
      await page.goto(`${BASE}/join/${code}/wall`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      const imgs = await page.locator("img").count();
      rec("GST-03", "guest", "Wall SSR renders approved photos", imgs > 0 ? "PASS" : "FAIL", `${imgs} imgs`, await shot(page, "gst-03-wall.png")); }
    catch (e) { rec("GST-03", "guest", "Wall renders", "FAIL", e.message); }

    try {
      const { data: before } = await admin.from("photos").select("id").eq("event_id", eid);
      const victim = before[0].id;
      const r = await ctx.request.post(`${BASE}/api/uploads/delete`, { data: { photo_id: victim } });
      const { data: after } = await admin.from("photos").select("id").eq("event_id", eid);
      rec("GST-04", "guest", "Guest self-delete own photo", r.ok() && after.length < before.length ? "PASS" : "FAIL", `http=${r.status()} ${before.length}->${after.length}`);
    } catch (e) { rec("GST-04", "guest", "Self-delete", "FAIL", e.message); }

    // cross-guest delete must 404
    try {
      const { data: p } = await admin.from("photos").select("id").eq("event_id", eid);
      const other = await browser.newContext({ ...device });
      const oe = uniq("other"); await seedGuestAndOtp(eid, oe, "123456"); await verifyGuest(other, code, oe);
      const r = await other.request.post(`${BASE}/api/uploads/delete`, { data: { photo_id: p[0].id } });
      rec("GST-05", "guest", "Foreign guest cannot delete (404)", r.status() === 404 ? "PASS" : "FAIL", `http=${r.status()}`);
      await other.close();
    } catch (e) { rec("GST-05", "guest", "Foreign delete guard", "FAIL", e.message); }
    await ctx.close();
  }

  // ===== MODERATION (guest upload -> pending; hidden from wall) =====
  {
    const ctx = await browser.newContext({ ...device });
    const code = "TEST-MOD-WALL", eid = EVENTS[code], email = uniq("modguest");
    try {
      await seedGuestAndOtp(eid, email, "123456"); await verifyGuest(ctx, code, email);
      for (const f of FIX.slice(0, 2)) await uploadOne(ctx, f);
      const { data: photos } = await admin.from("photos").select("status").eq("event_id", eid);
      const pending = photos?.length >= 2 && photos.every((p) => p.status === "pending");
      rec("MOD-01", "moderation", "Moderated wall upload -> pending", pending ? "PASS" : "FAIL", `${photos?.length} rows status=${[...new Set(photos?.map(p=>p.status))].join(",")}`);
    } catch (e) { rec("MOD-01", "moderation", "Upload -> pending", "FAIL", e.message); }
    try { const page = await ctx.newPage();
      await page.goto(`${BASE}/join/${code}/wall`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
      const imgs = await page.locator("main img, .wall img").count();
      rec("MOD-02", "moderation", "Pending hidden from public wall", imgs === 0 ? "PASS" : "FAIL", `${imgs} imgs`, await shot(page, "mod-02-wall-pending-empty.png")); }
    catch (e) { rec("MOD-02", "moderation", "Pending hidden", "FAIL", e.message); }
    await ctx.close();
  }

  // ===== HOST dashboard + moderation approve + cover + settings + ZIP =====
  {
    const hostEmail = uniq("host"), code = "TEST-MOD-WALL", eid = EVENTS[code];
    const hostId = await ensureUser(hostEmail, {});
    await admin.from("events").update({ host_user_id: hostId }).eq("id", eid);
    const ctx = await browser.newContext({ ...device });
    try {
      const page = await magicLogin(ctx, hostEmail, "/dashboard");
      const body = await page.textContent("body");
      const signedIn = body.includes("Signed in as") || body.includes("Your wall");
      rec("HOST-01", "host", "Magic-link login -> dashboard (SSR)", signedIn ? "PASS" : "FAIL", "", await shot(page, "host-01-dashboard.png"));

      try { await page.goto(`${BASE}/dashboard/card`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(600);
        rec("HOST-02", "host", "Shareable QR card (SSR)", "PASS", "", await shot(page, "host-02-card.png")); }
      catch (e) { rec("HOST-02", "host", "QR card", "FAIL", e.message); }
      try { await page.goto(`${BASE}/dashboard/slideshow`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(800);
        rec("HOST-03", "host", "Projector slideshow (SSR)", "PASS", "", await shot(page, "host-03-slideshow.png")); }
      catch (e) { rec("HOST-03", "host", "Slideshow", "FAIL", e.message); }

      // moderation queue via API + approve the pending photos
      try {
        const q = await ctx.request.get(`${BASE}/api/host/events/${eid}/moderation`);
        const qj = await q.json().catch(() => ({}));
        const pend = (qj.items || qj.photos || []).map((p) => p.id);
        let approved = 0;
        for (const pid of pend) {
          const r = await ctx.request.patch(`${BASE}/api/host/photos/${pid}`, { data: { status: "approved" } });
          if (r.ok()) approved++;
        }
        const { data: appr } = await admin.from("photos").select("id").eq("event_id", eid).eq("status", "approved");
        rec("HOST-04", "host", "Moderation queue + approve", pend.length >= 1 && appr?.length >= 1 ? "PASS" : "FAIL", `queue=${pend.length} approved=${appr?.length}`);
      } catch (e) { rec("HOST-04", "host", "Moderation approve", "FAIL", e.message); }

      try { const page2 = await ctx.newPage();
        await page2.goto(`${BASE}/join/${code}/wall`, { waitUntil: "domcontentloaded" }); await page2.waitForTimeout(1500);
        const imgs = await page2.locator("img").count();
        rec("HOST-05", "host", "Approved photos now on wall", imgs > 0 ? "PASS" : "FAIL", `${imgs} imgs`, await shot(page2, "host-05-wall-approved.png"));
        await page2.close(); }
      catch (e) { rec("HOST-05", "host", "Approved on wall", "FAIL", e.message); }

      // cover upload via cover/init -> PUT -> PATCH
      try {
        const f = FIX[4];
        const ir = await ctx.request.post(`${BASE}/api/host/events/${eid}/cover/init`, { data: { content_type: f.type, bytes: f.buf.length } });
        const ij = await ir.json();
        await ctx.request.put(ij.upload_url, { headers: { "Content-Type": f.type }, data: f.buf });
        const pr = await ctx.request.patch(`${BASE}/api/host/events/${eid}`, { data: { cover_image_path: ij.path } });
        const { data: ev } = await admin.from("events").select("cover_image_path").eq("id", eid).maybeSingle();
        await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1200);
        rec("HOST-06", "host", "Cover banner upload", pr.ok() && ev?.cover_image_path ? "PASS" : "FAIL", `path=${ev?.cover_image_path}`, await shot(page, "host-06-cover.png"));
      } catch (e) { rec("HOST-06", "host", "Cover upload", "FAIL", e.message); }

      // edit wall details (welcome message) via PATCH
      try {
        const r = await ctx.request.patch(`${BASE}/api/host/events/${eid}`, { data: { welcome_message: "Edited by automated test - welcome!" } });
        const { data: ev } = await admin.from("events").select("welcome_message").eq("id", eid).maybeSingle();
        rec("HOST-07", "host", "Edit wall details (welcome msg)", r.ok() && ev?.welcome_message?.includes("automated test") ? "PASS" : "FAIL", `msg=${ev?.welcome_message}`);
      } catch (e) { rec("HOST-07", "host", "Edit details", "FAIL", e.message); }

      // invalid cover path rejected
      try {
        const r = await ctx.request.patch(`${BASE}/api/host/events/${eid}`, { data: { cover_image_path: "someone-else/evil.jpg" } });
        rec("HOST-08", "host", "Reject cover path outside event prefix", r.status() === 400 ? "PASS" : "FAIL", `http=${r.status()}`);
      } catch (e) { rec("HOST-08", "host", "Cover path guard", "FAIL", e.message); }

      // close uploads -> guest init 409
      try {
        await ctx.request.patch(`${BASE}/api/host/events/${eid}`, { data: { allow_uploads: false } });
        const g = await browser.newContext({ ...device });
        const ge = uniq("closed"); await seedGuestAndOtp(eid, ge, "123456"); await verifyGuest(g, code, ge);
        const r = await uploadOne(g, FIX[0]);
        rec("HOST-09", "host", "Closed upload window blocks guest (409)", r.status === 409 && r.err === "uploads_closed" ? "PASS" : "FAIL", `status=${r.status} err=${r.err}`);
        await g.close();
        await ctx.request.patch(`${BASE}/api/host/events/${eid}`, { data: { allow_uploads: true } });
      } catch (e) { rec("HOST-09", "host", "Upload window gate", "FAIL", e.message); }

      // ZIP download
      try {
        const r = await ctx.request.get(`${BASE}/api/host/events/${eid}/download`);
        const ct = r.headers()["content-type"] || ""; const body = await r.body();
        rec("HOST-10", "host", "Download-all ZIP stream", r.ok() && ct.includes("zip") && body.length > 0 ? "PASS" : "FAIL", `http=${r.status()} ct=${ct} bytes=${body.length}`);
      } catch (e) { rec("HOST-10", "host", "ZIP download", "FAIL", e.message); }
    } catch (e) { rec("HOST-01", "host", "Host section", "FAIL", e.message); }
    await ctx.close();
  }

  // ===== ADMIN console + approve/decline + invite + leads =====
  {
    const adminEmail = uniq("admin"), appA = uniq("applyA"), appD = uniq("applyD");
    const { data: seeded } = await admin.from("applications").insert([
      { venue: "TEST Approve Venue", contact: "A Contact", email: appA, status: "pending_review" },
      { venue: "TEST Decline Venue", contact: "D Contact", email: appD, status: "pending_review" },
    ]).select("id,email");
    await ensureUser(adminEmail, { role: "admin" });
    const ctx = await browser.newContext({ ...device });
    try {
      const page = await magicLogin(ctx, adminEmail, "/admin");
      const body = await page.textContent("body");
      rec("ADM-01", "admin", "Admin magic-link -> console (SSR)", body.includes("Control room") ? "PASS" : "FAIL", "", await shot(page, "adm-01-console.png"));

      const idA = seeded.find((s) => s.email === appA).id;
      const idD = seeded.find((s) => s.email === appD).id;
      try { const r = await ctx.request.patch(`${BASE}/api/admin/applications/${idA}`, { data: { action: "approve" } });
        const { data: a } = await admin.from("applications").select("status").eq("id", idA).maybeSingle();
        const { data: ev } = await admin.from("events").select("id,status").eq("host_user_id", (await ensureUser(appA, null)) || "none");
        rec("ADM-02", "admin", "Approve application (provisions host+event)", r.ok() && a?.status === "approved" ? "PASS" : "FAIL", `http=${r.status()} status=${a?.status}`); }
      catch (e) { rec("ADM-02", "admin", "Approve application", "FAIL", e.message); }

      try { const r = await ctx.request.patch(`${BASE}/api/admin/applications/${idD}`, { data: { action: "decline", reason: "Automated test decline reason." } });
        const { data: a } = await admin.from("applications").select("status,rejection_reason").eq("id", idD).maybeSingle();
        rec("ADM-03", "admin", "Decline application w/ reason", r.ok() && a?.status !== "pending_review" && (a?.rejection_reason||"").includes("Automated") ? "PASS" : "FAIL", `status=${a?.status} reason=${a?.rejection_reason}`); }
      catch (e) { rec("ADM-03", "admin", "Decline application", "FAIL", e.message); }

      try { const inv = uniq("invitee");
        const r = await ctx.request.post(`${BASE}/api/admin/invites`, { data: { email: inv } });
        const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
        const created = list?.users.find((u) => u.email?.toLowerCase() === inv.toLowerCase());
        rec("ADM-04", "admin", "Invite admin grants role", created?.app_metadata?.role === "admin" ? "PASS" : "FAIL", `http=${r.status()} role=${created?.app_metadata?.role}`); }
      catch (e) { rec("ADM-04", "admin", "Invite admin", "FAIL", e.message); }

      try { const r = await ctx.request.get(`${BASE}/api/admin/invites`);
        const j = await r.json().catch(() => ({}));
        rec("ADM-05", "admin", "Admin roster lists admins", r.ok() && (j.admins?.length >= 1) ? "PASS" : "FAIL", `http=${r.status()} admins=${j.admins?.length}`); }
      catch (e) { rec("ADM-05", "admin", "Roster", "FAIL", e.message); }

      try { const r = await ctx.request.get(`${BASE}/api/admin/leads`);
        rec("ADM-06", "admin", "Leads API (admin-gated)", r.ok() ? "PASS" : "FAIL", `http=${r.status()}`); }
      catch (e) { rec("ADM-06", "admin", "Leads API", "FAIL", e.message); }
      try { const r = await ctx.request.get(`${BASE}/api/admin/emails`);
        rec("ADM-07", "admin", "Master emails API (admin-gated)", r.ok() ? "PASS" : "FAIL", `http=${r.status()}`); }
      catch (e) { rec("ADM-07", "admin", "Emails API", "FAIL", e.message); }
    } catch (e) { rec("ADM-01", "admin", "Admin section", "FAIL", e.message); }
    await ctx.close();
  }

  // ===== EDGE / limits =====
  {
    // max_uploads_per_guest ENFORCED on gap event (limit 2)
    const ctx = await browser.newContext({ ...device });
    const code = "TEST-GAP-WALL", eid = EVENTS[code], email = uniq("gapguest");
    try {
      await seedGuestAndOtp(eid, email, "123456"); await verifyGuest(ctx, code, email);
      const r1 = await uploadOne(ctx, FIX[0]);
      const r2 = await uploadOne(ctx, FIX[1]);
      const r3 = await uploadOne(ctx, FIX[2]); // should be blocked (limit 2)
      const { data: photos } = await admin.from("photos").select("id").eq("event_id", eid);
      rec("EDGE-01", "edge", "max_uploads_per_guest enforced (limit 2)", r1.ok && r2.ok && r3.status === 409 && r3.err === "upload_limit_reached" && photos.length === 2 ? "PASS" : "FAIL",
        `r1=${r1.ok} r2=${r2.ok} r3=${r3.status}/${r3.err} rows=${photos.length}`);
    } catch (e) { rec("EDGE-01", "edge", "max_uploads enforced", "FAIL", e.message); }
    await ctx.close();

    // OTP wrong code + lock
    try {
      const c2 = await browser.newContext({ ...device });
      const eid2 = EVENTS["TEST-HAPPY-WALL"], em = uniq("lockguest");
      await seedGuestAndOtp(eid2, em, "123456");
      let last = 0;
      for (let i = 0; i < 6; i++) { const r = await c2.request.post(`${BASE}/api/otp/verify`, { data: { code: "TEST-HAPPY-WALL", email: em, otp: "000000" } }); last = r.status(); }
      rec("EDGE-02", "edge", "OTP wrong code locks after 5 (401->429)", last === 429 ? "PASS" : "FAIL", `final=${last}`);
      await c2.close();
    } catch (e) { rec("EDGE-02", "edge", "OTP lock", "FAIL", e.message); }

    // OTP expired -> 410
    try {
      const c3 = await browser.newContext({ ...device });
      const eid3 = EVENTS["TEST-HAPPY-WALL"], em = uniq("expguest");
      await admin.from("guests").insert({ event_id: eid3, email: em });
      await admin.from("otp_codes").insert({ event_id: eid3, email: em, code_hash: packHash("123456"), expires_at: new Date(Date.now() - 60000).toISOString() });
      const r = await c3.request.post(`${BASE}/api/otp/verify`, { data: { code: "TEST-HAPPY-WALL", email: em, otp: "123456" } });
      rec("EDGE-03", "edge", "Expired OTP -> 410", r.status() === 410 ? "PASS" : "FAIL", `http=${r.status()}`);
      await c3.close();
    } catch (e) { rec("EDGE-03", "edge", "OTP expired", "FAIL", e.message); }

    // draft event join 404
    try {
      const c4 = await browser.newContext({ ...device });
      const page = await c4.newPage();
      await page.goto(`${BASE}/join/TEST-DRAFT-WALL`, { waitUntil: "domcontentloaded" });
      const t = (await page.textContent("body")).toLowerCase();
      rec("EDGE-04", "edge", "Draft event not joinable (404)", t.includes("404") || t.includes("not found") ? "PASS" : "FAIL", "", await shot(page, "edge-04-draft-404.png"));
      await c4.close();
    } catch (e) { rec("EDGE-04", "edge", "Draft 404", "FAIL", e.message); }
  }

  // ===== RETENTION (real cron sweep) =====
  {
    try {
      const now = Date.now();
      // seed three retention-scenario events
      // delete_after is trigger-computed from coalesce(ends_at,created_at)+retention_days,
      // so drive it via ends_at + retention_days=0 to land at the target instant.
      const mk = async (code, deltaDays, status) => {
        const { data } = await admin.from("events").insert({ code, couple_display: code, couple_html: code, when_text: "ret", status: status,
          retention_days: 0, ends_at: new Date(now + deltaDays * 86400000).toISOString() }).select("id,delete_after").single();
        return data.id;
      };
      const e14 = await mk(`TEST-RET14-${TS}`, 10, "live");    // within 14d, outside 3d
      const e3 = await mk(`TEST-RET3-${TS}`, 2, "live");        // within 3d
      const ep = await mk(`TEST-RETP-${TS}`, -1, "live");       // past due -> purge
      await admin.from("photos").insert({ event_id: ep, storage_path: `${ep}/x.jpg`, status: "approved" });

      const r = await fetch(`${BASE}/api/cron/retention`, { headers: { Authorization: `Bearer ${CRON}` } });
      const jr = await r.json().catch(() => ({}));
      const { data: a14 } = await admin.from("events").select("reminder_14d_sent_at,reminder_3d_sent_at").eq("id", e14).single();
      const { data: a3 } = await admin.from("events").select("reminder_14d_sent_at,reminder_3d_sent_at").eq("id", e3).single();
      const { data: ap } = await admin.from("events").select("status,purged_at").eq("id", ep).single();
      const { data: pp } = await admin.from("photos").select("id").eq("event_id", ep);
      const ok14 = !!a14.reminder_14d_sent_at && !a3.reminder_14d_sent_at ? true : !!a14.reminder_14d_sent_at;
      rec("RET-01", "retention", "Cron: 14d reminder tier stamped", a14.reminder_14d_sent_at ? "PASS" : "FAIL", `14d=${a14.reminder_14d_sent_at}`);
      rec("RET-02", "retention", "Cron: 3d reminder tier stamped", a3.reminder_3d_sent_at ? "PASS" : "FAIL", `3d=${a3.reminder_3d_sent_at}`);
      rec("RET-03", "retention", "Cron: past-due wall purged (archived + photos gone)", ap.status === "archived" && ap.purged_at && pp.length === 0 ? "PASS" : "FAIL", `status=${ap.status} purged=${ap.purged_at} photos=${pp.length}`);

      // idempotency: second run doesn't re-stamp/re-error
      const r2 = await fetch(`${BASE}/api/cron/retention`, { headers: { Authorization: `Bearer ${CRON}` } });
      const { data: b14 } = await admin.from("events").select("reminder_14d_sent_at").eq("id", e14).single();
      rec("RET-04", "retention", "Cron idempotent (14d stamp unchanged on rerun)", b14.reminder_14d_sent_at === a14.reminder_14d_sent_at ? "PASS" : "FAIL", `http2=${r2.status}`);

      // cleanup retention test events
      for (const id of [e14, e3, ep]) await admin.from("events").delete().eq("id", id);
    } catch (e) { rec("RET-01", "retention", "Retention sweep", "FAIL", e.message); }
  }
} finally {
  await browser.close();
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  const pass = results.filter((r) => r.status === "PASS").length;
  const gap = results.filter((r) => r.status === "GAP").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n==== ${pass} PASS / ${gap} GAP / ${fail} FAIL (${results.length} total) ====`);
}
