import { describe, expect, it, vi } from "vitest";
import { LABEL_REFRESH_MS, LabelDirectory, officeLabels } from "./labels";
import { MockGmail, OFFICE } from "./test/mock-gmail";

const PARENTS = ["DN", "DS"];

describe("officeLabels (FR-08)", () => {
  it("keeps user labels under OFFICE_LABEL_PARENTS, sorted", async () => {
    const labels = await new MockGmail().labelsList();
    expect(officeLabels(labels, PARENTS)).toEqual(["DN/Kafr ElDawar", "DN/Tanta", "DS/Zagazig"]);
  });
});

describe("LabelDirectory (FR-07, FR-08)", () => {
  it("resolves a label name to its Gmail id", async () => {
    const dir = new LabelDirectory(new MockGmail(), PARENTS, () => {});
    expect(await dir.idOf(OFFICE.name, new Date())).toBe(OFFICE.id);
  });

  it("fails clearly for an unknown label", async () => {
    const dir = new LabelDirectory(new MockGmail(), PARENTS, () => {});
    await expect(dir.idOf("DN/Nowhere", new Date())).rejects.toThrow("DN/Nowhere");
  });

  it(`refreshes at most every ${LABEL_REFRESH_MS / 60_000} minutes`, async () => {
    const gmail = new MockGmail();
    const dir = new LabelDirectory(gmail, PARENTS, () => {});
    const t0 = new Date("2026-10-16T08:00:00Z");

    expect(await dir.refresh(t0)).toEqual(["DN/Kafr ElDawar", "DN/Tanta", "DS/Zagazig"]);
    expect(await dir.refresh(new Date(t0.getTime() + LABEL_REFRESH_MS - 1))).toBeNull();
    await dir.idOf(OFFICE.name, new Date(t0.getTime() + 1000));
    expect(gmail.count("labelsList")).toBe(1);

    expect(await dir.refresh(new Date(t0.getTime() + LABEL_REFRESH_MS))).not.toBeNull();
    expect(gmail.count("labelsList")).toBe(2);
  });

  it("logs a refresh failure and keeps the cached labels", async () => {
    const log = vi.fn();
    const t0 = new Date("2026-10-16T08:00:00Z");
    const ok = new LabelDirectory(new MockGmail(), PARENTS, log);
    await ok.refresh(t0);
    // Same directory, Gmail now failing.
    Object.assign(ok, { gmail: new MockGmail({ failLabels: 500 }) });

    expect(await ok.refresh(new Date(t0.getTime() + LABEL_REFRESH_MS))).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("label refresh failed"));
    expect(await ok.idOf(OFFICE.name, new Date(t0.getTime() + LABEL_REFRESH_MS))).toBe(OFFICE.id);
  });
});
