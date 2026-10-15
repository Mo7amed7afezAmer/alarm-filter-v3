import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMessage } from "./index";

// Cases derived from samples/subjects.txt and samples/bodies.jsonl (approved 2026-10-15).
const casesDir = fileURLToPath(new URL("../../../../samples/parser", import.meta.url));
const read = (dir: string, file: string) => {
  const path = join(casesDir, dir, file);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};

const cases = readdirSync(casesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

describe("samples/parser", () => {
  it("has the 25 approved cases", () => {
    expect(cases).toHaveLength(25);
  });

  it.each(cases)("%s", (name) => {
    const subject = read(name, "subject.txt")!;
    const body = read(name, "body.txt");
    const expected = JSON.parse(read(name, "expected.json")!) as Record<string, unknown>;

    // JSON round trip: Dates become ISO strings and absent fields disappear.
    const actual = JSON.parse(JSON.stringify(parseMessage(subject, body))) as Record<string, unknown>;

    if (expected.format === "HUAWEI") {
      // FR-13: only the format and the missing alarm time are specified.
      expect(actual).toMatchObject(expected);
    } else {
      expect(actual).toEqual(expected);
    }
  });
});
