# UnityWall

A shared photo wall for weddings and events. Mobile-first PWA — guests scan a QR, sign the guestbook, upload photos, and watch the wall fill up live.

Production: configured to deploy to Vercel as a static SPA with rewrites.

## Surfaces (path-based, single web app, role-gated)

| Route                 | Surface             | Auth                    |
| --------------------- | ------------------- | ----------------------- |
| `/`                   | Home hub            | None                    |
| `/join`               | Manual code entry   | None                    |
| `/join/{CODE}`        | Guest wall flow     | None (QR drops here)    |
| `/request`            | Venue application   | None                    |
| `/dashboard`          | Host dashboard      | Magic link              |
| `/admin`              | Internal admin      | Magic link + role gate  |

Admin and `/dashboard` render a true desktop layout above 900px viewport width; below that, they fall back to the mobile layout. Mobile-only routes (guest flow) remain phone-framed at all widths.

## Stack

- Vanilla HTML/CSS/JS (no build step today; ready for a React/Next migration when Supabase wiring lands).
- Supabase (Postgres + Auth + Storage + RLS) for the production backend.
- Resend for transactional email (magic-link OTP, hot-lead notifications) — **server-side only**.
- Vercel for hosting; SPA rewrites in `vercel.json`.

## Local dev

```bash
python3 serve.py        # SPA fallback server on http://127.0.0.1:4173
```

Or any static server that falls back to `index.html` for unknown paths.

## Environment

Copy `.env.example` → `.env.local`. The `NEXT_PUBLIC_*` keys are safe to ship to the browser; everything else must stay server-side.

| Var                              | Where           |
| -------------------------------- | --------------- |
| `NEXT_PUBLIC_SUPABASE_URL`       | client + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | client + server |
| `SUPABASE_SERVICE_ROLE_KEY`      | server only     |
| `SUPABASE_SECRET_KEY`            | server only     |
| `RESEND_API_KEY`                 | server only     |
| `RESEND_FROM`                    | server only     |
| `ADMIN_NOTIFY_EMAIL`             | server only     |

## Deploy

```bash
vercel link
vercel env add SUPABASE_SERVICE_ROLE_KEY ...
vercel deploy --prod
```
