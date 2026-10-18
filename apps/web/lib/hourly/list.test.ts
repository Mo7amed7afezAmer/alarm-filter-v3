import { describe, expect, it } from "vitest";
import { HOURLY_LIST_REFRESH_MS } from "@/components/hourly-list";

describe("hourly report list (FR-64, NFR-06)", () => {
  it("is refreshed every 60 s", () => {
    expect(HOURLY_LIST_REFRESH_MS).toBe(60_000);
  });
});
