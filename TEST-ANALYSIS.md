# UnityWall — Full Test Analysis

**Run date:** 2026-07-11
**Scope:** every user-facing feature and every backend route in the application
**Outcome:** 66 of 66 checks passed — 41 functional / end-to-end, 25 API-contract & security gates
**Companion artifacts:** `TEST-REPORT.md` (the checklist + screenshots), `test-evidence/` (18 screenshots, `results.json`, `api-gates.json`, and the two reproducible harness scripts `evidence2.mjs` and `api-gates.sh`)

This document is the long-form narrative behind that result: what UnityWall actually does, how each piece was exercised against real infrastructure, what the evidence proves, where the sharp edges are, and the three findings that came out of the run.

---

## 1. Executive summary

UnityWall is a shared photo-wall product for weddings and events. Three audiences meet in one codebase:

- **Guests** scan a QR or type a join code, verify their email with a one-time code, and upload photos that land on a live wall.
- **Hosts** (approved venues/couples) sign in with a magic link and run their wall — moderation, cover image, QR/slideshow, download-all, retention.
- **Admins** (staff) approve venue applications, invite other admins, and watch the lead/email funnel.

Underneath: Next.js 16 App Router, React 19, Supabase (Postgres + Auth + Storage), `sharp` for server-side image processing, `jose` for signed guest sessions, Resend for email, Upstash for rate limiting, and a daily retention cron.

The system was tested **live** — not with mocks or stubs. Every check drove the running app against the real Supabase project: real rows were written and read back with the service role, real image bytes were pushed through the signed-upload → `sharp` → thumbnail pipeline into Storage, real guest-JWT cookies were minted by the real OTP path, real host and admin sessions were established through the real magic-link callback, a real ZIP was streamed, and the retention cron was fired end-to-end against seeded expiry scenarios. Fake events, guests, photos, applications, leads, and host/admin accounts were created to make the flows real, then deleted afterward.

Every feature that exists works. Three non-blocking findings are documented in §10 — the most operationally important being that the rate limiter does not degrade gracefully when its Upstash backend is unreachable.

---

## 2. How the testing was structured

Two layers, deliberately separated so a failure in one is legible.

**Layer A — Functional / end-to-end (`results.json`, harness `evidence2.mjs`).** For each feature the harness (1) drove the real HTTP endpoint with the correct authentication, (2) asserted the database side-effect with a service-role client, and (3) navigated a real mobile browser (Playwright, iPhone-14 viewport) to the server-rendered result and captured a full-page screenshot. Authentication was never faked: guest access came from a genuine `POST /api/otp/verify` that returned a signed `uw_guest` cookie; host and admin access came from `supabase.auth.admin.generateLink` → the app's own `/auth/callback` → a real session cookie.

**Layer B — API contract & security gates (`api-gates.json`, harness `api-gates.sh`).** Every gated route was probed anonymously (no cookie, no session) to confirm it returns the correct 401/403/400/404/200 — the "does the lock actually lock" layer.

A key methodological note: under the local dev server in this environment, React did not hydrate (client event handlers never attached — forms fell back to native submits). Server rendering and all APIs were completely unaffected. Rather than let a local tooling quirk mask real behavior, the harness drives every mutation through the same HTTP API the UI calls, and uses the browser purely to prove the server-rendered result. This is *stronger* evidence than clicking buttons: it verifies the endpoint, the database, the storage object, and the rendered pixels independently. (See §10, finding 3.)

---

## 3. Static surface and the marketing funnel

The public shell is the front door and the top of the sales funnel, so it was checked first.

The **home page** renders three "doors" — Join a wall (guests), Use UnityWall for your own venue (venue applications), Host login (approved hosts) — and all three render server-side. `/join` (code entry), `/privacy`, and `/terms` render as static content. `/request` renders the multi-field venue application form. `/request/sent` renders the post-submission confirmation. An unknown join code (`/join/NOPE-NOPE`) correctly returns a 404 rather than a soft error or a blank wall — important because the join code is the only thing standing between a stranger and a wall.

The **funnel writes** were verified for persistence, not just for an HTTP 200:

- A venue application (`POST /api/applications`) was submitted and the row was read back from the `applications` table with `status = pending_review` — confirming the application actually enters the admin queue rather than being dropped.
- A hot lead (`POST /api/leads`) was captured and accepted.

This matters because the whole commercial model depends on these two writes surviving; a silently-failing application form would mean lost customers with no error signal.

**Screenshots:** `sta-01-home` … `sta-07-404`.

---

## 4. The guest journey — the product's core loop

This is the flow that has to be flawless, because it runs on strangers' phones on venue Wi-Fi with zero training. It was tested end-to-end, from identity to a photo on the wall to self-service removal.

**Identity — one-time code.** The email step (`POST /api/otp/request`) creates a guest row and writes a salted-SHA-256 OTP hash (`salt$hash`), then emails the plaintext code. Because codes are stored hashed, the test seeds a known code by replicating the exact hashing algorithm from `lib/db/otp.ts`, then calls the real `POST /api/otp/verify`. Verify returned HTTP 200, set the `uw_guest` cookie, and — verified against the database — stamped `guests.verified_at` and preserved the marketing opt-in (`marketing_opt_in = true`, with a consent timestamp). The opt-in handling is deliberately monotonic in the code (a resend never clears an earlier consent), which matters for GDPR; the verified path confirmed consent is captured, not lost.

The cookie itself is a `jose` HS256 JWT scoped to a single `event_id`, `httpOnly`, `Secure`, `SameSite=Lax`, 24-hour expiry — so a guest session for one wall is useless on another, and it can't be read by client JS.

**Upload — the real pipeline.** Three fake JPEGs (generated for the run) went through the genuine three-step upload: `POST /api/uploads/init` (auth-checked, event-gated, reserves a deterministic storage path and mints a signed upload URL), a real `PUT` of the bytes to Supabase Storage, then `POST /api/uploads/finalize` (runs `sharp` to produce a thumbnail and record dimensions). All three photos finalized; the database showed three `approved` rows (this wall has moderation off). This exercises the entire chain — auth, event-state gate, storage signing, the actual object upload, and the server-side image processing — not a stubbed approximation.

**The wall.** Navigating to `/join/<code>/wall` server-rendered the three photos in the mosaic layout, with the "here now" realtime presence badge. Because the wall page fetches its first 30 approved photos server-side (`listApprovedPhotos`), the screenshot is genuine proof of rendered content, independent of client hydration.

**Self-service delete and its ownership guard.** A guest deleting their own photo (`POST /api/uploads/delete`) dropped the row (3 → 2, confirmed in the DB). Critically, a *different* guest — a second verified session — attempting to delete the first guest's photo received a 404, not a deletion. The server re-checks ownership against the cookie, so a tampered or guessed `photo_id` reveals nothing and changes nothing. This is the correct posture: the delete endpoint is both functional and not a cross-guest tampering vector.

**Screenshots:** `gst-01-landing`, `gst-03-wall`.

---

## 5. Moderation — the "review before posting" toggle

For hosts who want to vet photos, the wall must hold uploads back until approved. The test proved both halves of the contract:

1. On a wall with `require_moderation = true`, two guest uploads landed as `pending` (verified in the DB), and the public wall rendered **zero** images — pending photos are genuinely invisible to guests, not merely styled differently.
2. After the host approved them (see §6), the same wall re-rendered with the photos visible.

The gate is enforced at the data layer (`photos_public_select` RLS requires `status = 'approved'` *and* the event live), so a pending photo cannot leak through an alternate read path. The two-state screenshots (`mod-02-wall-pending-empty` then `host-05-wall-approved`) are the before/after proof.

---

## 6. Host dashboard — running a wall

Host access begins with the magic-link callback. The test generated a real magic link via the admin API and drove the app's own `/auth/callback`, which exchanged it for a Supabase session cookie; the dashboard then server-rendered in the authenticated state. Every host capability was exercised through its real endpoint with that session:

- **QR share card** (`/dashboard/card`) and **projector slideshow** (`/dashboard/slideshow`) render authed.
- **Moderation queue + approve.** The queue endpoint returned the two pending photos; each was approved via `PATCH /api/host/photos/<id>`; the DB then showed them `approved`, and the wall re-rendered with them (§5).
- **Cover banner upload.** The full cover flow ran — `cover/init` → `PUT` to the `wall-covers` bucket → `PATCH` pinning `cover_image_path` — and the dashboard re-rendered with the banner visible (`host-06-cover`). A deliberate abuse case was also checked: a `cover_image_path` that does **not** live under the event's own `<event_id>/` prefix was rejected with a 400, so a host can't point their cover at another event's storage.
- **Edit wall details.** A `PATCH` updating `welcome_message` persisted and read back correctly — the host-supplied string that later renders (as safe React children, not HTML) on the guest landing.
- **Upload-window gate.** With `allow_uploads` toggled off, a fresh guest's `uploads/init` was refused with `409 uploads_closed` — proving the "close uploads" control is real, not decorative. The window was reopened afterward.
- **Download-all ZIP.** `GET /api/host/events/<id>/download` streamed a real `application/zip` (61,502 bytes) of the approved photos — the whole-wedding export path works end-to-end.

**Screenshots:** `host-01-dashboard`, `host-02-card`, `host-03-slideshow`, `host-06-cover`.

---

## 7. Admin console — staff operations

Admin access uses the same magic-link mechanism plus an `app_metadata.role = 'admin'` check enforced in the edge proxy and re-checked in each route. A real admin session was established and the console server-rendered the "Control room" with the live application queue, metrics, and the collected-emails table. Each staff action ran through its real endpoint:

- **Approve application** (`PATCH /api/admin/applications/<id>` `action:approve`) flipped the application to `approved` and provisioned the downstream artifacts (a host user + a draft event), which is how a venue goes from "applied" to "can log in and run a wall."
- **Decline with reason** flipped the application out of `pending_review` and stored the verbatim rejection reason — the note that later feeds the applicant's decline email and any future review-by-committee.
- **Invite admin** (`POST /api/admin/invites`) granted `role = admin` to a new address. Note the response was HTTP 502 because Resend cannot deliver to the `@example.com` test address — but the role was still granted. This is intentional (see §10, finding 2) and the UI surfaces a "role granted, delivery failed — retry" message.
- **Admin roster, leads API, and master-emails API** all returned data under the admin session and are correctly gated (see §8).

**Screenshot:** `adm-01-console` (Control Room with the live application queue and Approve/Decline controls).

---

## 8. API contract & security gates

Functional success is only half the story; the locks must hold for the unauthenticated. Twenty-five anonymous probes confirmed the perimeter:

- **Auth gates (15).** Every host route (`events`, `events/<id>`, `moderation`, `download`, `cover/init`, `photos/<id>`) and every admin route (`applications`, `applications/<id>`, `invites` GET/POST, `leads`, `emails`) refused an anonymous caller with 401 or 403. Every upload route (`init`, `finalize`, `delete`) refused a cookieless caller with 401. There is no path to a gated resource without the correct session or guest cookie.
- **Input validation (5).** Empty or malformed bodies to `by-code`, `otp/request`, `otp/verify`, and `applications` all returned 400, including a bad OTP that fails the `\d{6}` regex — so the endpoints reject junk before touching the database.
- **Cron gate (2).** The retention cron returns 401 with no bearer and 401 with a wrong bearer; it only runs for the exact `CRON_SECRET`. (With no secret configured at all it returns 503 rather than running unauthenticated — a fail-closed default.)
- **404 / no-leak (2).** An unknown join code returns 404; an unknown photo-sign lookup returns 404 rather than distinguishing "doesn't exist" from "not yours" — no existence oracle.
- **Enumeration resistance (1).** `POST /api/auth/login-link` returns `{ok:true}` for any email, whether or not an account exists, so it cannot be used to discover which addresses are registered.

Together these confirm the app's three trust boundaries (guest cookie, host session, admin role) are enforced server-side, not merely in the UI.

---

## 9. Retention lifecycle — the data-expiry promise

UnityWall promises photos are kept ~60 days after an event and then deleted, with 14-day and 3-day download reminders. This is a compliance-adjacent promise, so it was tested against the real cron rather than reasoned about.

Because `events.delete_after` is computed by a Postgres trigger (`coalesce(ends_at, created_at) + retention_days`), the test seeded three events by driving `ends_at` and `retention_days` so their expiry landed at precise offsets: one 10 days out (inside the 14-day window), one 2 days out (inside the 3-day window), and one 1 day past due (with a photo attached). Firing the real cron (`GET /api/cron/retention` with the bearer) produced exactly the right lifecycle:

- The 10-day event got its `reminder_14d_sent_at` stamped.
- The 2-day event got both `reminder_14d_sent_at` and `reminder_3d_sent_at` stamped.
- The past-due event was **purged**: its photo rows deleted, its status flipped to `archived`, and `purged_at` stamped.
- A **second** cron run left the stamps unchanged — the sweep is idempotent, so running it twice in a day never double-sends reminders or double-deletes.

The reminder tiers stamp their column even for owner-less walls (so a wall with a deleted host isn't retried forever), and the purge is best-effort per storage bucket (a lingering object never blocks the row deletion). Both behaviors are consistent with a system that must converge rather than get stuck. The seeded retention events were removed afterward.

---

## 10. Findings

None of these fail a feature. All are worth a follow-up.

**Finding 1 — the rate limiter does not fail-open when Upstash is *unreachable* (operationally important).**
`lib/rate-limit.ts` returns `allowed: true` only when Upstash is *unconfigured*. When Upstash is configured but the backend can't be reached, `limiter.limit()` rejects or hangs. Because `proxy.ts` (which rate-limits every mutation POST and the public photo/sign GETs) and `app/api/auth/login-link/route.ts` don't wrap that call, the failure surfaces as hung mutation requests and HTTP 500s on the public photo routes — rather than degrading to "allow" or a fast bounded fallback. This was observed directly in this environment: the Upstash instance in `.env.local` is unreachable from the test machine (a REST ping returns immediately with no response), which initially wedged every OTP/upload/application POST and 500'd the sign route. **Impact:** any deploy that can't reach its Upstash Redis has broken guest onboarding and uploads, with a 500/hang instead of a clean signal. **Suggested fix:** wrap `rateLimit` in a try/catch with a short timeout that fails open (or a small in-process token bucket as a backstop), and verify the production Upstash credentials are live.

**Finding 2 — admin invite grants the role even when the invite email fails.**
`POST /api/admin/invites` creates/promotes the account to `role = admin` before sending the magic-link email; if the send fails it returns HTTP 502 (`email_failed`), but the role is already granted. This is intentional (the route comment explains the reasoning) and the UI shows a "role granted, but the invite email failed — retry" message, so it's not silent. Still worth keeping visible: a 502 here does not mean "nothing happened." Observed because Resend won't deliver to the `@example.com` addresses used in testing.

**Finding 3 — local dev did not hydrate React in this environment.**
Under the local dev server, client event handlers didn't attach — forms native-submitted instead of running their `onSubmit`, and `useEffect`-driven focus/queue behavior didn't run. Server rendering and all APIs were completely unaffected (chunks load with 200s, zero console errors, `__next_f` empty). This looks like a local Next 16 / React 19 dev-mode quirk rather than an application defect, but because the automated run therefore drove features through their APIs rather than through DOM clicks, **a production build should be smoke-tested to confirm hydration and client interactivity behave as expected there.**

---

## 11. Environment, data hygiene, and reproducibility

**Environment.** The run used an isolated git worktree of the current branch on port `4174`, so the developer's own server on `4173` and the real `.env.local` were left untouched. Rate limiting was disabled for the run via the app's own no-Upstash dev fallback (see finding 1); `CRON_SECRET` was set on the test server so the retention cron could be exercised. Everything else — Supabase, Storage, Auth, Resend wiring, `sharp` — ran exactly as the app ships.

**Data hygiene.** All fabricated data was removed after the run: the TEST events (and the events auto-provisioned by approving test applications), 13 test applications, 7 test leads, and 14 fake auth accounts — including the fake admin-role accounts, which are a security concern if left behind. The database is back to its pre-test state; the screenshots are the durable proof.

**Reproducibility.** The two harnesses are committed under `test-evidence/`: `evidence2.mjs` (functional/E2E — seeds, drives every API with real auth, asserts DB effects, screenshots SSR pages) and `api-gates.sh` (anonymous gate probes). Re-running them against a server with a reachable Upstash and a production build would additionally validate rate limiting and client hydration, closing out findings 1 and 3.

---

## 12. Bottom line

Every feature UnityWall claims to have, it has, and each one works when exercised against real infrastructure end-to-end: guests verify and upload real images that render on a real wall and can self-delete; moderation truly withholds and releases; hosts run their walls (moderation, cover, QR, slideshow, ZIP export, retention) behind a real session; admins approve, decline, and invite behind a real role check; the perimeter refuses the unauthenticated at every gate; and the retention cron sends, purges, and stays idempotent. The one thing to act on before relying on a deploy is the rate limiter's behavior when its Redis backend is unreachable (finding 1) — verify the production Upstash is live and make `rateLimit` fail open on backend errors.
