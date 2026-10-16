import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractXlsxFromRar, HourlyReportError, limitsFromEnv } from "./index";

const dir = fileURLToPath(new URL("../../../../samples/hourly/", import.meta.url));
const rar = new Uint8Array(readFileSync(dir + "nsn-update-output.rar"));
const xlsx = new Uint8Array(readFileSync(dir + "nsn-update-output.xlsx"));
// The WebAssembly build of unrar shipped with node-unrar-js (D-10, D-11: no unrar binary, no temp files).
const wasm = readFileSync(createRequire(import.meta.url).resolve("node-unrar-js/esm/js/unrar.wasm"));
const wasmBinary = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength);

describe("extractXlsxFromRar (FR-51, in memory)", () => {
  it("extracts the one workbook of the real report, byte for byte", async () => {
    const out = await extractXlsxFromRar(rar, limitsFromEnv({}), wasmBinary);
    expect(out.name).toBe("NSN Update_Output.xlsx");
    expect(out.data).toEqual(xlsx);
  });

  it("checks the RAR headers before extracting (declared size above the limit)", async () => {
    await expect(extractXlsxFromRar(rar, { maxRarBytes: 25 * 1024 * 1024, maxExtractBytes: 1000 }, wasmBinary)).rejects.toMatchObject({
      code: "EXTRACT_TOO_LARGE",
    });
  });

  it("rejects data that is not a RAR archive", async () => {
    const err = await extractXlsxFromRar(xlsx, limitsFromEnv({}), wasmBinary).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HourlyReportError);
    expect((err as HourlyReportError).code).toBe("BAD_ARCHIVE");
  });
});
