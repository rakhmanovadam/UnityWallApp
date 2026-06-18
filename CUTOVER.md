# UnityWall · cutover checklist

Step 11 of the Next.js migration. Promote the `next-migration` branch to
production once steps 1–10 are verified.

## 1. Pre-flight against the preview deploy

The branch auto-deploys to a Vercel preview URL on every push. Validate
the whole flow there first.

- [ ] `supabase/migrations/0001_init.sql` applied in the SQL editor.
- [ ] `supabase/audit/rls-check.sql` returns `rls_enabled = t` for all
      seven tables and a non-zero `policy_count` where expected.
- [ ] `supabase/audit/anon-readonly.sql` shows zero rows for guests,
      otp_codes, leads, applications, audit_log under `set role anon`.
- [ ] First admin promoted:
      ```sql
      update auth.users
         set raw_app_meta_data =
           jsonb_set(coalesce(raw_app_meta_data,'{}'), '{role}', '"admin"')
       where email = 'support@unitywall.co';
      ```
- [ ] All env vars present on Vercel for Production + Preview +
      Development (see `.env.example`). Critical for the preview to even
      boot:
      - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
      - `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`
      - `RESEND_API_KEY`, `RESEND_FROM`, `ADMIN_NOTIFY_EMAIL`
      - `GUEST_JWT_SECRET` (32-byte hex), `APP_BASE_URL`
      - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` for
        per-IP rate limiting (without these the limiter no-ops).
- [ ] Resend domain `unitywall.co` verified (Dashboard → Domains).
      Until then `RESEND_FROM=UnityWall <onboarding@resend.dev>` works
      for testing into your own inbox.
- [ ] At least one of the seed events has `host_user_id` set so the
      host dashboard renders for a known account:
      ```sql
      update public.events
         set host_user_id = (select id from auth.users where email = '<host>')
       where code = 'MAYA-DANIEL';
      ```
- [ ] Playwright deterministic suite is green:
      `pnpm test:e2e --project=desktop-chrome -- tests/e2e/deterministic.spec.ts`
- [ ] Live-data Playwright with `UW_E2E_LIVE=1 pnpm test:e2e -- tests/e2e/data-dependent.spec.ts`
      passes against the preview URL.
- [ ] Lighthouse mobile audit on `/join/MAYA-DANIEL/wall` ≥ 90 perf,
      ≥ 95 a11y. Run with `npx unlighthouse --site <preview-url>` or the
      Chrome DevTools panel.

## 2. Promotion to production on Vercel

UnityWall is deployed from `main` on the `bioquests-projects` Vercel
team to the project that owns `unitywall-psi.vercel.app`.

- [ ] Open a PR from `next-migration` → `main`. Self-review the diff in
      the GitHub UI; CI on the PR should still be green from the preview.
- [ ] Merge with a merge commit (not squash) so the step-by-step history
      survives in `main`.
- [ ] Vercel auto-promotes the `main` push to production. Watch the
      deployment in
      https://vercel.com/bioquests-projects/unitywall/deployments
      and confirm the build completes.
- [ ] Sanity check the live URL: load `/`, `/join`, `/join/MAYA-DANIEL`,
      `/dashboard`, `/admin` — no 500s in the function logs.

## 3. Domain cutover (`unitywall.co`)

Optional, do this after Resend domain verification finishes:

- [ ] Add `unitywall.co` and `www.unitywall.co` as domains in the Vercel
      project. Vercel issues the cert and shows the required DNS A /
      CNAME entries.
- [ ] Add those records at your registrar. Once propagation finishes
      Vercel flips the cert to "active."
- [ ] Update `APP_BASE_URL` on Vercel (Production) to
      `https://unitywall.co`. Trigger a redeploy from the dashboard.
- [ ] Update the QR-encoded URL: the dashboard re-renders against the
      new `APP_BASE_URL` automatically on next page load, but printed
      cards from before this step still point to the old domain.

## 4. Rollback plan

If the production deploy misbehaves:

- Vercel → Deployments → previous successful deployment → "Promote to
  Production." This is instant; the migration's DB shape doesn't break
  the previous build because the old SPA didn't read the new tables.
- Worst case revert the merge commit on `main` and let Vercel deploy
  the revert: `git revert -m 1 <merge-sha> && git push origin main`.

## 5. Cleanup once you're settled

- [ ] Delete the `legacy/` directory — the SPA is no longer needed and
      it pollutes greps. Use `git rm -r legacy/` and commit.
- [ ] Drop the `next-migration` branch on the remote.
- [ ] Rotate every credential that was pasted in chat during this
      migration (see `unitywall-credentials` memory).
