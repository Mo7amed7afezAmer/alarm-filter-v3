import { expect, test, type Page } from "@playwright/test";
import { expectedLists } from "../test/fixtures";
import { E2E_USER } from "./global-setup";

// G-T09: alarm lists at 390 px (NFR-37 card views, FR-34 Site Master data) against the seeded fixture.
const activeTotal = expectedLists.find((q) => q.name === "active-default")!.expected.total;

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(E2E_USER.email);
  await page.getByLabel("Password").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/alarms");
}

test.describe("at 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("/alarms shows the seeded active alarms as cards", async ({ page }) => {
    await signIn(page);
    await expect(page.getByTestId("total")).toHaveText(String(activeTotal));
    await expect(page.getByTestId("alarm-card")).toHaveCount(activeTotal);
    await expect(page.locator("table.alarms")).toBeHidden();

    // FR-34: Site Master data on the card, phone as a tel: link.
    const card = page.getByTestId("alarm-card").filter({ hasText: "BH-UMB-BH_3926DE" });
    await expect(card).toContainText("Nodality 1+0");
    await expect(card.getByRole("link")).toHaveAttribute("href", /^tel:0100000\d{4}$/);
  });

  test("the filter bar is collapsed and opens on demand (NFR-37)", async ({ page }) => {
    await signIn(page);
    const filters = page.locator("form.filters");
    await expect(filters).toBeHidden();
    await page.getByRole("button", { name: "Filters" }).click();
    await expect(filters).toBeVisible();
    await page.getByLabel("Category").selectOption("POWER");
    await expect(page.getByTestId("total")).toHaveText(
      String(expectedLists.find((q) => q.name === "active-category-power")!.expected.total),
    );
  });

  test("/cleared renders its card list", async ({ page }) => {
    await signIn(page);
    await page.goto("/cleared");
    await expect(page.getByRole("heading", { name: "Cleared alarms" })).toBeVisible();
    await expect(page.locator("table.alarms")).toBeHidden();
  });
});
