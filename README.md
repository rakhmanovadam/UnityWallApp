# UnityWall

QR-based shared photo wall for weddings and events. Guests scan a QR at
`/join/{CODE}`, sign the guestbook with an email OTP, upload from their
phone, and watch the wall fill in live. Also doubles as a lead-capture
funnel and back-office for vetted host applications.

- Live: https://unitywall-psi.vercel.app
- Stack: Next.js 16 (App Router) · React 19 · Supabase (Postgres + Auth
  + Storage + Realtime) · Resend · Upstash Redis (rate limit) · sharp
  (image pipeline) · Playwright (e2e).

## Repository layout

```
app/                Next.js App Router — routes + colocated page components
  api/              route handlers (host, admin, guest OTP, uploads, etc.)
  admin/            admin console + magic-link login
  dashboard/        host dashboard + printable QR card + slideshow
  join/[code]/      guest flow: email → OTP → upload → wall
  request/          "apply to host" funnel
lib/                shared server code (never import from client)
  env.ts            typed env loader (Zod)
  supabase/         browser / server / admin / proxy Supabase clients
  db/               server-side DB helpers, one file per table
  email/            Resend transactional templates
  sharp/            HEIC→JPEG + EXIF strip pipeline
  rate-limit.ts     Upstash sliding-window buckets
  guest-jwt.ts      HS256 JWT for the uw_guest cookie
  render.tsx        XSS-safe couple_display renderer
proxy.ts            Next 16 middleware (auth cookie refresh + rate limits)
public/             static assets, service worker, styles.css
supabase/           SQL migration + RLS audit scripts
tests/e2e/          Playwright specs
legacy/             pre-Next.js vanilla SPA — pending deletion (CUTOVER.md)
```

## Getting started

```bash
pnpm install
cp .env.example .env.local   # fill in Supabase + Resend + Upstash + JWT
pnpm dev                     # http://localhost:4173
```

### Environment

Every env var used by the app is declared in `lib/env.ts` and documented
in `.env.example`. Public (browser-inlined) vars are prefixed
`NEXT_PUBLIC_`; everything else is server-only and never reaches the
client bundle. See `SECURITY.md` for the rotation checklist.

### Database

The schema lives in `supabase/migrations/0001_init.sql`. Apply it via
the Supabase SQL editor once per project, then run the audit scripts in
`supabase/audit/` to confirm RLS is enabled and anon can't read
sensitive tables.

To promote a user to admin:

```sql
update auth.users
   set raw_app_meta_data =
     jsonb_set(coalesce(raw_app_meta_data,'{}'), '{role}', '"admin"')
 where email = 'support@unitywall.co';
```

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Local dev server on `:4173`. |
| `pnpm build` | Production build. |
| `pnpm start` | Serve the production build on `:4173`. |
| `pnpm typecheck` | `tsc --noEmit` — no runtime. |
| `pnpm lint` | Next.js ESLint. |
| `pnpm test:e2e` | Playwright e2e suite. |

## Deploy

Vercel team `bioquests-projects`, project `unitywall`. Merges to `main`
auto-promote to production. See `CUTOVER.md` for the promotion + rollback
checklist.
