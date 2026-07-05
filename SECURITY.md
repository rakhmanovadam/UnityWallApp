# UnityWall — security notes

## Reporting

Please email `support@unitywall.co` if you find something. No public
issue tracker for security reports.

## Data model + who sees what

- **Public (unauthenticated)**: live events, approved photos on live
  events. Enforced by RLS (`events.status='live'`, `photos.status='approved'
  and event_is_live(event_id)`).
- **Guest (OTP-signed `uw_guest` cookie)**: upload to their own
  `(event_id, guest_id)`. JWT is HS256, 24h TTL, `httpOnly + secure +
  sameSite=lax`. Verified in `lib/guest-jwt.ts`.
- **Host (Supabase magic link)**: their own events + photos.
  Identity check is `events.host_user_id = auth.uid()` (`lib/host-session.ts`).
- **Admin (Supabase magic link + `app_metadata.role='admin'`)**: full
  access via service-role helpers (`lib/admin-session.ts`).

The service-role key is loaded only from `lib/supabase/admin.ts` and is
never imported into a `"use client"` module — that split is enforced by
having `lib/env.ts::serverEnv()` be a function rather than a top-level
constant.

## Hardening applied

- **XSS**: guest-visible `couple_display` is rendered via
  `lib/render.tsx::renderCoupleDisplay` — React children, never
  `dangerouslySetInnerHTML`. The one remaining use of
  `dangerouslySetInnerHTML` is the QR code, which is a server-generated
  SVG from the `qrcode` package.
- **Input validation**: every `/api/*` handler validates with Zod
  before touching the database or Resend.
- **RLS**: enabled on every user table; audit scripts in
  `supabase/audit/` verify anon can't read `guests`, `otp_codes`,
  `leads`, `applications`, `audit_log`.
- **OTP**: 6-digit code, salted SHA-256 storage (`otp_codes.code_hash =
  salt$hash`), 10-min TTL, 5 attempts → lock, constant-time compare.
- **Rate limits** (Upstash sliding window, per-IP; enforced in
  `proxy.ts`):
  - OTP request: 10 / 60 s per IP + 3 / 15 min per (event, email).
  - Leads / applications: 5 / 60 s per IP.
  - Uploads init/finalize: 60 / 60 s per IP.
- **Storage**: private `wall-photos` + `wall-thumbs` buckets. Guest
  uploads use signed PUT URLs; downloads use short-lived signed thumb
  URLs (1h). Full-resolution originals are never publicly URL'd.
- **Image processing**: sharp strips EXIF (kills GPS leaks),
  auto-orients, caps longest edge at 2400 px, converts HEIC/HEIF to
  JPEG, enforces `MAX_BYTES = 25_000_000`.
- **Security headers** (`next.config.ts`): CSP (allowlisted for
  Supabase + Google Fonts + `wss:` for Realtime), HSTS w/ preload,
  X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy
  strict-origin-when-cross-origin, Permissions-Policy blocking camera /
  mic / geolocation.
- **Cookies**: `uw_guest` is `httpOnly + secure + sameSite=lax`;
  Supabase's auth cookies inherit `@supabase/ssr` defaults (same flags).

## Known gaps

- CSP still needs `'unsafe-inline'` on `script-src` for Next hydration
  and on `style-src` for legacy inline styles. Tightening to nonces is
  a future task.
- Host magic-link sign-in goes browser → Supabase directly, so our
  proxy can't rate-limit it — we rely on Supabase's per-email limit.
  If we want tighter control, proxy the call through
  `/api/host/login`.
- `postcss < 8.5.10` moderate CVE arrives transitively through Next.
  Overridden in `package.json` (`pnpm.overrides`) to `>=8.5.10`.

## Rotation checklist — 2026-07-02 chat exposure

Every credential pasted in chat during the 2026-07-02 session must be
rotated before real production traffic. Assume anything ever pasted
into a chat transcript is compromised.

| Credential | Where to rotate |
| --- | --- |
| Supabase `service_role` (JWT) | https://supabase.com/dashboard/project/rnptnfwfaewelvolkkqo/settings/api → "Generate new service_role" |
| Supabase `sb_secret_*` | Same page → "Reset secret key" |
| Supabase DB password | https://supabase.com/dashboard/project/rnptnfwfaewelvolkkqo/settings/database |
| Supabase `anon` (JWT) | Same API page → "Reset anon key" (optional — anon is designed to be public, but rotating unlocks a fresh key if the old one was tied to a bad build) |
| Resend API key | https://resend.com/api-keys — delete the leaked key, mint a new one |
| Google OAuth client secret | https://console.cloud.google.com/apis/credentials → the `1001920554569-...` client → "Reset secret" |

After rotating, push the new values into Vercel (Production + Preview +
Development) with `vercel env add ...` or via the dashboard, then
redeploy so the running app picks them up.

## Secret scanning

`gitleaks` runs as a pre-commit hook via `.pre-commit-config.yaml`.
Install it once locally:

```bash
brew install pre-commit gitleaks
pre-commit install
```

CI should run `gitleaks detect --source . --redact` on every PR.
