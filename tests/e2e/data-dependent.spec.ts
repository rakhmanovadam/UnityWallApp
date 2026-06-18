import { test, expect } from "@playwright/test";

// Tests that require a populated Supabase project. Skip when the
// migration hasn't been applied or the demo seed is missing.
// Set UW_E2E_LIVE=1 in the environment to opt in.

test.describe(() => {
  test.skip(
    !process.env.UW_E2E_LIVE,
    "Set UW_E2E_LIVE=1 to run; needs the migration applied and seed rows.",
  );

  // Acceptance test #1 (full guest journey) — partial: drives the UI to
  // the OTP screen. The OTP code itself can be pulled by calling
  // supabase.auth.admin.generateLink or by configuring Mailosaur; without
  // either, this test stops at "send code" and verifies the screen
  // transition.
  test("guest can request a code for MAYA-DANIEL", async ({ page }) => {
    await page.goto("/join");
    await page.getByLabel("Join code").fill("MAYA-DANIEL");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(
      page.getByRole("heading", { name: /Maya/i }),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole("link", { name: /Add your photos/ }).click();
    await page.getByLabel("Your email").fill("e2e@unitywall.local");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(
      page.getByRole("heading", { name: /Enter your code/ }),
    ).toBeVisible();
  });

  // Acceptance test #4 sanity for the live data path — even with the
  // migration applied, an unknown code still 404s.
  test("/join/UNKNOWN-CODE still 404s with data", async ({ page }) => {
    const response = await page.goto("/join/UNKNOWN-CODE", {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(404);
  });

  // Acceptance test #8: leads endpoint accepts a valid hot lead body.
  // We don't assert on the email arrival (that needs Mailosaur).
  test("POST /api/leads accepts a hot lead", async ({ request }) => {
    const res = await request.post("/api/leads", {
      data: {
        source: "hot",
        code: "MAYA-DANIEL",
        email: "e2e+hot@unitywall.local",
        message: "automated test",
      },
    });
    expect(res.status()).toBe(200);
  });

  // Acceptance test #8: applications endpoint accepts a valid body.
  test("POST /api/applications accepts a venue application", async ({
    request,
  }) => {
    const res = await request.post("/api/applications", {
      data: {
        venue: "E2E Test Venue",
        contact: "E2E Bot",
        email: "e2e+venue@unitywall.local",
        phone: "(615) 555-0000",
        notes: "automated test — safe to ignore",
      },
    });
    expect(res.status()).toBe(200);
  });
});

// Acceptance tests still missing here, with notes on how to wire them:
//
// #1 (full guest e2e ending with photo on wall): needs a way to read the
//     6-digit OTP. Two options: (a) inject Mailosaur as RESEND_FROM and
//     poll the inbox; (b) bypass via a test-only route under NODE_ENV=test
//     that returns the latest OTP for a given email — DELETE before prod.
// #2 (two-browser Realtime appears within 2s): playwright supports
//     multiple browser contexts; pair with the #1 plumbing.
// #3 (wrong OTP 5 times locks): same OTP-injection prerequisite.
// #6 (host magic link → toggle require_moderation): same magic-link
//     bypass needed; supabase.auth.admin.generateLink({type:'magiclink'})
//     works and is already used by the admin approve route.
// #7 (admin approves application → applicant becomes host): chain the
//     admin login flow + #4's existing application row.
// #10 (Lighthouse on /join/:CODE/wall ≥ 90 perf / ≥ 95 a11y on mobile):
//     run `npx unlighthouse --site http://127.0.0.1:4173` against the
//     local dev server, or wire up the @lhci/cli action in CI.
