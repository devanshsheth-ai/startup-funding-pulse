import { randomUUID } from "node:crypto";

/**
 * Structured JSON logger. Every line carries `run_id` when one is bound, so a
 * single pipeline run can be traced across stages.
 *
 * Secret-looking keys are redacted, and known secret values from the
 * environment are scrubbed from strings, so a key never reaches the logs even
 * if an upstream error message echoes it.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

// "token" alone would also hide usage counts such as `tokens` / `gemini_tokens`;
// match credential-style token keys only.
const SECRET_KEY_PATTERN = /(secret|password|passwd|api[_-]?key|authorization|cookie|database_url|(^|[_-])token$|access[_-]?token|refresh[_-]?token|auth[_-]?token)/i;
const SECRET_ENV_KEYS = [
  "DATABASE_URL",
  "GEMINI_API_KEY",
  "RESEND_API_KEY",
  "CRON_SECRET",
  "ADMIN_SECRET",
  "NEWS_API_KEY",
] as const;
const REDACTED = "[redacted]";

function secretValues(): string[] {
  return SECRET_ENV_KEYS.map((k) => process.env[k]).filter(
    (v): v is string => typeof v === "string" && v.length >= 8,
  );
}

function scrubString(value: string, secrets: readonly string[]): string {
  let out = value;
  for (const s of secrets) out = out.split(s).join(REDACTED);
  // Connection strings carry credentials in the userinfo segment.
  return out.replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, `$1${REDACTED}@`);
}

export function redact(value: unknown, secrets: readonly string[] = secretValues(), depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") return scrubString(value, secrets);
  if (value instanceof Error) {
    return { name: value.name, message: scrubString(value.message, secrets) };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, secrets, depth + 1));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? REDACTED : redact(v, secrets, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: LogLevel, msg: string, base: LogFields, fields: LogFields | undefined): void {
  const line = JSON.stringify(
    redact({ ts: new Date().toISOString(), level, msg, ...base, ...fields }),
  );
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(base: LogFields = {}): Logger {
  return {
    debug: (msg, fields) => emit("debug", msg, base, fields),
    info: (msg, fields) => emit("info", msg, base, fields),
    warn: (msg, fields) => emit("warn", msg, base, fields),
    error: (msg, fields) => emit("error", msg, base, fields),
    child: (fields) => createLogger({ ...base, ...fields }),
  };
}

/** Run IDs are sortable by time: `run_<iso-compact>_<8 hex>`. */
export function newRunId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:.]/g, "").slice(0, 15);
  return `run_${stamp}_${randomUUID().slice(0, 8)}`;
}

export function runLogger(runId: string, stage?: string): Logger {
  return createLogger(stage ? { run_id: runId, stage } : { run_id: runId });
}

export const logger = createLogger();
