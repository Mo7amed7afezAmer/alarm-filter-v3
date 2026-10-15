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
