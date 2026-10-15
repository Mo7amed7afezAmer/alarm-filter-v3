import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { siteCodeOf } from "./index";

// FR-32: the last `_` segment when it matches ^[0-9A-Z]{3,6}[A-Z]{2}$.
const casesDir = fileURLToPath(new URL("../../../../samples/parser", import.meta.url));
const sampleSites = [
  ...new Set(
    readdirSync(casesDir)
      .map((d) => JSON.parse(readFileSync(join(casesDir, d, "expected.json"), "utf8")) as { site?: string })
      .filter((e) => e.site)
      .map((e) => e.site!),
  ),
].sort();

describe("siteCodeOf (FR-32)", () => {
  const expected: Record<string, string> = {
    "0111_S_QL-KFR-ARAB_3891DE": "3891DE",
    "1021_S_GH-SHBRA-MALAS_0738DE": "0738DE",
    "2421_O_MF-HK-FRAWNYH_0G01DE": "0G01DE",
    "3531_S_KS-SHARAQA_3961DE": "3961DE",
    "SRAN_LG_TDD_E_BH-WASTANIYA_3804DE": "3804DE",
    "SRAN_LWG_D_BH-SHOBRA-RIS_4360DE": "4360DE",
    "SRAN_LWG_D_QL-MSAKN-ZABAL_3230DE": "3230DE",
    "SRAN_LWG_TDD_G_DK-KFR-BAHAYTA_3752DE": "3752DE",
    "SRAN_LWG_TDD_G_SK-ADLIYA_3458DE": "3458DE",
    "SRAN_LWG_TDD_J_DK-BESHLA-PS_0732DE": "0732DE",
    "SRAN_LWG_TDD_O_BH-BIRKT-GHTS2_0H33DE": "0H33DE",
    "SRAN_LWG_TDD_S_BH-OASIS-RD-2_4319DE": "4319DE",
    "SRAN_LWG_TDD_S_MF-ZARQAN_3377DE": "3377DE",
    "SRAN_LWG_TDD_V_BH-KFDW-BOLES_3207DE": "3207DE",
    "U_C_QL-TANT-GIZIRA_0694DE": "0694DE",
    "U_S_BH-HAMMAD_3809DE": "3809DE",
    "U_S_BH-HORRIA_3928DE": "3928DE",
    "U_S_BH-MHLT-KYL_3830DE": "3830DE",
  };

  it("covers every site in samples/parser", () => {
    expect(Object.keys(expected).sort()).toEqual(sampleSites);
  });

  it.each(Object.entries(expected))("%s → %s", (site, code) => {
    expect(siteCodeOf(site)).toBe(code);
  });

  it.each([
    ["October-RNC33", "no `_` segment of the code shape"],
    ["SRAN_LWG_TDD_G_SK-ADLIYA", "last segment is not a code"],
    ["SRAN_LWG_3458de", "lower-case code"],
    ["SRAN_LWG_34DE", "too short"],
    ["SRAN_LWG_1234567DE", "too long"],
  ])("%s → null (%s)", (site) => {
    expect(siteCodeOf(site)).toBeNull();
  });
});
