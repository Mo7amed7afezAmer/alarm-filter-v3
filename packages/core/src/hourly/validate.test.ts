import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertSafeEntryName,
  attachmentKind,
  checkEntries,
  HourlyReportError,
  limitsFromEnv,
  validateRar,
  validateXlsx,
  zipUncompressedSize,
} from "./index";

const dir = fileURLToPath(new URL("../../../../samples/hourly/", import.meta.url));
const rar = new Uint8Array(readFileSync(dir + "nsn-update-output.rar"));
const xlsx = new Uint8Array(readFileSync(dir + "nsn-update-output.xlsx"));
const MB = 1024 * 1024;
const limits = limitsFromEnv({});

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof HourlyReportError) return e.code;
    throw e;
  }
  return null;
};

describe("limitsFromEnv (FR-50 … FR-52)", () => {
  it("defaults to HOURLY_MAX_RAR_MB 25 and HOURLY_MAX_EXTRACT_MB 100", () => {
    expect(limitsFromEnv({})).toEqual({ maxRarBytes: 25 * MB, maxExtractBytes: 100 * MB });
  });
  it("reads the env values", () => {
    expect(limitsFromEnv({ HOURLY_MAX_RAR_MB: "50", HOURLY_MAX_EXTRACT_MB: "200" })).toEqual({
      maxRarBytes: 50 * MB,
      maxExtractBytes: 200 * MB,
    });
  });
});

describe("attachmentKind (FR-48, FR-52)", () => {
  it.each([
    ["NSN Update_Output.rar", "rar"],
    ["REPORT.RAR", "rar"],
    ["NSN Update_Output.xlsx", "xlsx"],
    ["logo.png", "other"],
  ])("%s → %s", (name, kind) => {
    expect(attachmentKind(name)).toBe(kind);
  });
});

describe("validateRar (FR-50)", () => {
  it("accepts the real report RAR", () => {
    expect(() => validateRar("NSN Update_Output.rar", rar, limits)).not.toThrow();
  });
  it("rejects a name that is not .rar", () => {
    expect(code(() => validateRar("report.zip", rar, limits))).toBe("NOT_RAR");
  });
  it("rejects a RAR above HOURLY_MAX_RAR_MB", () => {
    expect(code(() => validateRar("r.rar", rar, { ...limits, maxRarBytes: rar.length - 1 }))).toBe("TOO_LARGE");
  });
  it("rejects a file without the RAR signature 52 61 72 21 1A 07", () => {
    const bad = rar.slice();
    bad[3] = 0;
    expect(code(() => validateRar("r.rar", bad, limits))).toBe("BAD_SIGNATURE");
  });
});

describe("validateXlsx (FR-52)", () => {
  it("accepts the real report workbook", () => {
    expect(() => validateXlsx("NSN Update_Output.xlsx", xlsx, limits)).not.toThrow();
  });
  it("reads the declared uncompressed size from the ZIP directory", () => {
    expect(zipUncompressedSize(xlsx)).toBe(5_378_210);
  });
  it("rejects a name that is not .xlsx", () => {
    expect(code(() => validateXlsx("report.xls", xlsx, limits))).toBe("NOT_XLSX");
  });
  it("uses HOURLY_MAX_RAR_MB as its size limit (gap 26)", () => {
    expect(code(() => validateXlsx("r.xlsx", xlsx, { ...limits, maxRarBytes: xlsx.length - 1 }))).toBe("TOO_LARGE");
  });
  it("rejects a file without the ZIP signature 50 4B 03 04", () => {
    const bad = xlsx.slice();
    bad[2] = 0;
    expect(code(() => validateXlsx("r.xlsx", bad, limits))).toBe("BAD_SIGNATURE");
  });
  it("rejects a declared uncompressed size above HOURLY_MAX_EXTRACT_MB", () => {
    expect(code(() => validateXlsx("r.xlsx", xlsx, { ...limits, maxExtractBytes: 5_000_000 }))).toBe("EXTRACT_TOO_LARGE");
  });
});

describe("RAR entry checks (FR-51, NFR-24)", () => {
  it.each(["NSN Update_Output.xlsx", "folder/report.xlsx", "a..b.xlsx"])("accepts the safe name %j", (name) => {
    expect(() => assertSafeEntryName(name)).not.toThrow();
  });

  it.each(["/etc/passwd", "\\\\server\\x.xlsx", "C:\\x.xlsx", "../x.xlsx", "a/../../x.xlsx", "a\\..\\x.xlsx", "x\u0000.xlsx", ""])(
    "rejects the unsafe name %j",
    (name) => {
      expect(code(() => assertSafeEntryName(name))).toBe("UNSAFE_ENTRY");
    },
  );

  const file = (name: string, size = 1000, directory = false) => ({ name, size, directory });

  it("accepts exactly one .xlsx within the limits", () => {
    expect(checkEntries([file("NSN Update_Output.xlsx")], limits)).toBe("NSN Update_Output.xlsx");
  });
  it("rejects more than 20 entries", () => {
    const many = [file("a.xlsx"), ...Array.from({ length: 20 }, (_, i) => file(`n${i}.txt`))];
    expect(code(() => checkEntries(many, limits))).toBe("TOO_MANY_ENTRIES");
  });
  it("rejects a declared total size above HOURLY_MAX_EXTRACT_MB", () => {
    expect(code(() => checkEntries([file("a.xlsx", 101 * MB)], limits))).toBe("EXTRACT_TOO_LARGE");
  });
  it("rejects no workbook or two workbooks", () => {
    expect(code(() => checkEntries([file("notes.txt")], limits))).toBe("NO_WORKBOOK");
    expect(code(() => checkEntries([file("a.xlsx"), file("b.XLSX")], limits))).toBe("MULTIPLE_WORKBOOKS");
  });
  it("ignores directories when looking for the workbook", () => {
    expect(checkEntries([file("dir", 0, true), file("dir/a.xlsx")], limits)).toBe("dir/a.xlsx");
  });
  it("rejects an unsafe entry name", () => {
    expect(code(() => checkEntries([file("../a.xlsx")], limits))).toBe("UNSAFE_ENTRY");
  });
});
