import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { E2E_OPERATOR } from "./global-setup";

// G-T14: the hourly pipeline in the browser (D-10). Reports come from HOURLY_GMAIL_MOCK_DIR
// (playwright.config.ts); the Site Master endpoint of G-T15 is mocked with samples/hourly/site-master.json.
const samples = fileURLToPath(new URL("../../../samples/hourly/", import.meta.url));
const reference = JSON.parse(readFileSync(samples + "reference-output.json", "utf8")) as {
  stats: { rows: number; bySheet: Record<string, number> };
  rows: { sheet: string; category: string }[];
};
const golden = JSON.parse(readFileSync(samples + "golden-export.json", "utf8")) as {
  exports: { name: string; header: string[]; rows: (string | number | null)[][] }[];
};
const siteMaster = readFileSync(samples + "site-master.json", "utf8");
const REAL = "mock-nsn-update-output_rar";
const PLAIN = "mock-nsn-update-output_xlsx";
const BIG = "mock-report-40k_rar";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(E2E_OPERATOR.email);
  await page.getByLabel("Password").fill(E2E_OPERATOR.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/alarms");
}

/** Mocks GET /api/v1/hourly-reference (G-T15) and counts the requests. */
async function mockReference(page: Page) {
  const calls = { count: 0 };
  await page.route("**/api/v1/hourly-reference", async (route) => {
    calls.count++;
    const etag = '"2026-10-16T10:00:00.000Z"';
    if (route.request().headers()["if-none-match"] === etag) return route.fulfill({ status: 304, headers: { ETag: etag } });
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/json", ETag: etag },
      body: `{"updatedAt":"2026-10-16T10:00:00.000Z","normalizations":[],"siteMaster":${siteMaster}}`,
    });
  });
  return calls;
}

test.describe("hourly reports in the browser", () => {
  test("lists the reports and processes the real RAR in the browser (FR-47, FR-53 … FR-56)", async ({ page }) => {
    await mockReference(page);
    await signIn(page);
    await page.goto("/hourly");
    await expect(page.getByTestId("process").first()).toBeVisible({ timeout: 60_000 });
    await page.goto(`/hourly/${REAL}`);
    await expect(page.getByTestId("hourly-count")).toHaveText(reference.stats.rows.toLocaleString("en-US"), { timeout: 60_000 });
    await expect(page.getByTestId("hourly-row").first()).toBeVisible();
  });

  test("a plain .xlsx attachment gives the same rows (FR-52)", async ({ page }) => {
    await mockReference(page);
    await signIn(page);
    await page.goto(`/hourly/${PLAIN}`);
    await expect(page.getByTestId("hourly-count")).toHaveText(reference.stats.rows.toLocaleString("en-US"), { timeout: 60_000 });
  });

  test("sheet tabs and URL filters (FR-59, FR-62)", async ({ page }) => {
    await mockReference(page);
    await signIn(page);
    await page.goto(`/hourly/${REAL}?tab=Environmental&category=POWER`);
    const n = reference.rows.filter((r) => r.sheet === "Environmental" && r.category === "POWER").length;
    await expect(page.getByTestId("hourly-count")).toHaveText(n.toLocaleString("en-US"), { timeout: 60_000 });
  });

  test("the Excel export matches the golden file row for row (FR-60)", async ({ page }) => {
    await mockReference(page);
    await signIn(page);
    await page.goto(`/hourly/${REAL}`);
    await expect(page.getByTestId("hourly-count")).toHaveText(reference.stats.rows.toLocaleString("en-US"), { timeout: 60_000 });
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export .xlsx" }).click()]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(await download.path());
    const ws = wb.worksheets[0]!;
    const g = golden.exports.find((e) => e.name === "all-rows-default-columns")!;
    const cells: (string | number | null)[][] = [];
    ws.eachRow((row) => cells.push(g.header.map((_h, i) => (row.getCell(i + 1).value ?? null) as string | number | null)));
    expect(cells[0]).toEqual(g.header);
    expect(cells.slice(1)).toEqual(g.rows);
  });

  test("a second load makes no Site Master request (IndexedDB cache)", async ({ page }) => {
    const calls = await mockReference(page);
    await signIn(page);
    await page.goto(`/hourly/${REAL}`);
    await expect(page.getByTestId("hourly-count")).toHaveText(reference.stats.rows.toLocaleString("en-US"), { timeout: 60_000 });
    expect(calls.count).toBe(1);
    await page.goto(`/hourly/${PLAIN}`);
    await expect(page.getByTestId("hourly-count")).toHaveText(reference.stats.rows.toLocaleString("en-US"), { timeout: 60_000 });
    expect(calls.count).toBe(1);
  });

  test("table images per category, 40 rows each by default (FR-63)", async ({ page }) => {
    await mockReference(page);
    await signIn(page);
    await page.goto(`/hourly/${REAL}?tab=HW`);
    await expect(page.getByTestId("hourly-count")).toHaveText(String(reference.stats.bySheet.HW), { timeout: 60_000 });
    const downloads: string[] = [];
    page.on("download", (d) => downloads.push(d.suggestedFilename()));
    await page.getByRole("button", { name: "Download images" }).click();
    await expect.poll(() => downloads.length).toBe(Math.ceil(reference.stats.bySheet.HW! / 40));
    expect(downloads.every((n) => /^hourly-other-\d+\.png$/.test(n))).toBe(true);
  });

  test("shows the fallback message without WebAssembly", async ({ page }) => {
    await page.addInitScript(() => {
      // @ts-expect-error simulate a browser without WebAssembly
      delete window.WebAssembly;
    });
    await signIn(page);
    await page.goto("/hourly");
    await expect(page.getByText("cannot process hourly reports")).toBeVisible();
  });
});

// G-T14 timing on a production build (decided 2026-10-17): `next start` on :3201.
test.describe("hourly timing", () => {
  test.use({ baseURL: "http://localhost:3201" });
  test("40k rows within the laptop budget (warm median < 5 s, production build)", async ({ page }) => {
    await mockReference(page);
    await signIn(page);
    await page.goto("/hourly");
    await expect(page.getByTestId("process").first()).toBeVisible({ timeout: 60_000 });
    test.skip((await page.locator(`a[href="/hourly/${BIG}"]`).count()) === 0, "rar not installed: no 40k report");
    // Decided 2026-10-17: one warm-up run, then the median of three runs must stay under 5 s.
    // A reload drops the in-memory reports, so every run processes the file again.
    const runs: number[] = [];
    for (let i = 0; i < 4; i++) {
      await (i === 0 ? page.goto(`/hourly/${BIG}`) : page.reload());
      const ms = page.getByTestId("hourly-ms");
      await expect(ms).toBeVisible({ timeout: 120_000 });
      runs.push(Number(await ms.getAttribute("data-ms")));
    }
    const warm = runs.slice(1).sort((x, y) => x - y);
    const median = warm[1]!;
    console.log(`40k-row report: warm-up ${runs[0]} ms, runs ${runs.slice(1).join(" / ")} ms, median ${median} ms`);
    expect(median).toBeLessThan(5_000);
  });
});
