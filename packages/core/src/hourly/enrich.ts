// FR-55: Site Master fields by site code, region, and the unmatched / empty-code counts.
import { regionOf, type HourlyRow, type SiteMasterRecord } from "./types";

type Enrichment = Pick<HourlyRow, "office" | "nodality" | "vip" | "siteType" | "powerSource" | "battery" | "phone" | "region">;

export function enrichRows<R extends { siteCode: string }>(
  rows: R[],
  siteMaster: SiteMasterRecord[],
): {
  rows: (Omit<R, keyof Enrichment> & Enrichment)[];
  unmatched: number;
  emptyCodes: number;
} {
  const byCode = new Map(siteMaster.map((s) => [s.code.toUpperCase(), s]));
  let unmatched = 0;
  let emptyCodes = 0;
  const out = rows.map((row) => {
    const s = row.siteCode ? byCode.get(row.siteCode) : undefined;
    if (!row.siteCode) emptyCodes++;
    else if (!s) unmatched++;
    return {
      ...row,
      office: s?.office ?? null,
      nodality: s?.nodality ?? null,
      vip: s ? s.vip : null,
      siteType: s?.siteType ?? null,
      powerSource: s?.powerSource ?? null,
      battery: s?.battery ?? null,
      phone: s?.phone ?? null,
      region: regionOf(row.siteCode),
    };
  });
  return { rows: out, unmatched, emptyCodes };
}
