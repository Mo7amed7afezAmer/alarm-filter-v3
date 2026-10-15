/** FR-32: a site code is the last `_` segment of the site when it has this shape. */
export const SITE_CODE_RE = /^[0-9A-Z]{3,6}[A-Z]{2}$/;

export function siteCodeOf(site: string): string | null {
  const last = site.slice(site.lastIndexOf("_") + 1);
  return SITE_CODE_RE.test(last) ? last : null;
}
