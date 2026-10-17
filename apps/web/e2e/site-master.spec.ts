import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN, E2E_USER } from "./global-setup";

// G-T15: the Site Master settings page is ADMIN-only on the server (FR-67) while the API stays
// readable by any user; editing VIP inline shows the badge on /alarms (FR-34).
async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/alarms");
}

test("a VIEWER can read the API but cannot open the page", async ({ page }) => {
  await signIn(page, E2E_USER);
  const res = await page.request.get("/api/v1/site-master");
  expect(res.status()).toBe(200);
  expect((await res.json()).total).toBeGreaterThan(0);
  await page.goto("/settings/site-master");
  await page.waitForURL("**/alarms");
  await expect(page.getByRole("heading", { name: "Site Master" })).toHaveCount(0);
});

test("an ADMIN edits VIP inline and /alarms shows the badge", async ({ page }) => {
  await signIn(page, E2E_ADMIN);
  const row = page.locator("tr", { hasText: "BH-UMB-BH_3926DE" });
  await expect(row).toBeVisible();
  await expect(row.locator(".badge.vip")).toHaveCount(0);

  await page.goto("/settings/site-master");
  await page.getByLabel("Search").fill("3926DE");
  const site = page.getByTestId("site-row").filter({ hasText: "3926DE" });
  await expect(site).toHaveCount(1);
  await site.getByRole("button", { name: "Edit" }).click();
  await site.getByLabel("VIP").check();
  await site.getByLabel("Phone").fill("01000000000 / 0453000000");
  await site.getByRole("button", { name: "Save" }).click();
  await expect(site).toContainText("Yes");

  await page.goto("/alarms");
  await expect(page.locator("tr", { hasText: "BH-UMB-BH_3926DE" }).locator(".badge.vip")).toBeVisible();
});
