import type { GmailApi, GmailLabel } from "./gmail";
import type { Log } from "./ticker";

/** FR-08: office labels are refreshed at most this often. */
export const LABEL_REFRESH_MS = 10 * 60_000;

/** FR-08: user labels under one of the parents (`DN/…`, `DS/…`), sorted. */
export function officeLabels(labels: GmailLabel[], parents: string[]): string[] {
  return labels
    .filter((l) => l.type === "user" && parents.some((p) => l.name.startsWith(`${p}/`)))
    .map((l) => l.name)
    .sort();
}

/** Gmail labels by name (FR-07) with the FR-08 refresh throttle. */
export class LabelDirectory {
  private labels: GmailLabel[] | null = null;
  private fetchedAt = -Infinity;

  constructor(
    private gmail: GmailApi,
    private readonly parents: string[],
    private readonly log: Log,
  ) {}

  /** Re-reads the labels when the cache is older than 10 minutes; returns the office labels, or null when not refreshed. */
  async refresh(now: Date): Promise<string[] | null> {
    if (this.labels && now.getTime() - this.fetchedAt < LABEL_REFRESH_MS) return null;
    try {
      this.labels = await this.gmail.labelsList();
      this.fetchedAt = now.getTime();
      return officeLabels(this.labels, this.parents);
    } catch (err) {
      // FR-08: failures are logged only.
      this.log(`label refresh failed: ${err instanceof Error ? err.message : String(err)}`);
      if (this.labels) this.fetchedAt = now.getTime();
      return null;
    }
  }

  /** FR-07: the Gmail id of the label being read. */
  async idOf(name: string, now: Date): Promise<string> {
    if (!this.labels) await this.refresh(now);
    if (!this.labels) throw new Error(`cannot resolve Gmail label "${name}": labels could not be listed`);
    const label = this.labels.find((l) => l.name === name);
    if (!label) throw new Error(`Gmail label "${name}" not found`);
    return label.id;
  }
}
