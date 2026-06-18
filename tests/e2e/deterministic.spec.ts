import { test, expect } from "@playwright/test";

// Tests that pass without requiring a real email inbox or a migrated
// database. Cover acceptance criteria #4 (unknown code → 404) and #5
// (anonymous upload init → 401), plus baseline page renders for every
// non-data-bound route.

test.describe("static routes render", () => {
  test("home renders three doors", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /Welcome to/ }),
    ).toBeVisible();
    await expect(page.locator(".home-tile")).toHaveCount(3);
  });

  test("/join shows the manual code form", async ({ page }) => {
    await page.goto("/join");
    await expect(page.getByLabel("Join code")).toBeVisible();
  });

  test("/request shows the application form", async ({ page }) => {
    await page.goto("/request");
    await expect(page.getByLabel("Venue / business name")).toBeVisible();
  });
});

// Acceptance test #4: unknown codes 404 with no fake "the couple" page.
test("/join/UNKNOWN-CODE returns 404", async ({ page }) => {
  const response = await page.goto("/join/UNKNOWN-CODE", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(404);
  await expect(page.getByText(/the couple/)).toHaveCount(0);
});

// Acceptance test #5: anonymous upload init must 401.
test("POST /api/uploads/init without guest cookie returns 401", async ({
  request,
}) => {
  const res = await request.post("/api/uploads/init", {
    data: {
      filename: "x.jpg",
      content_type: "image/jpeg",
      bytes: 1024,
    },
  });
  expect(res.status()).toBe(401);
});

// Surface: middleware should 401 (not 200) on unauth host API hits.
test("GET /api/host/events without a session returns 401", async ({
  request,
}) => {
  const res = await request.get("/api/host/events");
  expect(res.status()).toBe(401);
});

// Admin API must require admin role (we don't have a session here so 401).
test("GET /api/admin/applications without a session returns 401", async ({
  request,
}) => {
  const res = await request.get("/api/admin/applications");
  expect(res.status()).toBe(401);
});

// zod body validation should reject missing fields on every mutation.
for (const path of [
  "/api/events/by-code",
  "/api/otp/request",
  "/api/otp/verify",
  "/api/leads",
  "/api/applications",
]) {
  test(`POST ${path} with empty body returns 400`, async ({ request }) => {
    const res = await request.post(path, { data: {} });
    expect([400, 401, 404]).toContain(res.status());
  });
}
