import cron from "node-cron";

// Worker configuration from the environment (REQUIREMENTS.md §6). Integers are validated at
// start-up (NFR-34). G-T06 reads the Gmail settings; G-T07 adds the runner settings.

export type Env = Record<string, string | undefined>;

export class ConfigError extends Error {}

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigError(`${name} is required`);
  return value;
}

export function int(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new ConfigError(`${name} must be a non-negative integer, got "${raw}"`);
  return Number(raw);
}

export interface GmailConfig {
  credentialsPath: string;
  tokenPath: string;
  initialBackfillHours: number;
  maxMessagesPerRun: number;
  gmailQuery: string;
}

export function loadGmailConfig(env: Env): GmailConfig {
  return {
    credentialsPath: required(env, "GOOGLE_CREDENTIALS_PATH"),
    tokenPath: required(env, "GOOGLE_TOKEN_PATH"),
    initialBackfillHours: int(env, "INITIAL_BACKFILL_HOURS", 24),
    maxMessagesPerRun: int(env, "MAX_MESSAGES_PER_RUN", 200),
    gmailQuery: env.GMAIL_QUERY?.trim() ?? "",
  };
}

export interface WorkerConfig extends GmailConfig {
  /** FR-01 / NFR-01: cycle schedule. */
  cron: string;
  /** FR-69: health port. */
  healthPort: number;
  /** FR-69: a last run older than this is stale. */
  healthStaleAfterSec: number;
  /** FR-07: default office label when none is selected (only the first entry is read). */
  gmailLabels: string[];
  /** FR-08: parents of the office labels. */
  officeLabelParents: string[];
  alarmTz: string;
}

const list = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function loadWorkerConfig(env: Env, validateCron: (expr: string) => boolean = cron.validate): WorkerConfig {
  const schedule = env.WORKER_CRON?.trim() || "* * * * *";
  if (!validateCron(schedule)) throw new ConfigError(`WORKER_CRON is not a valid cron expression: "${schedule}"`);
  const parents = list(env.OFFICE_LABEL_PARENTS);
  return {
    ...loadGmailConfig(env),
    cron: schedule,
    healthPort: int(env, "WORKER_HEALTH_PORT", 4000),
    healthStaleAfterSec: int(env, "HEALTH_STALE_AFTER_SEC", 300),
    gmailLabels: list(env.GMAIL_LABELS),
    officeLabelParents: parents.length ? parents : ["DN", "DS"],
    alarmTz: env.ALARM_TZ?.trim() || "Africa/Cairo",
  };
}

