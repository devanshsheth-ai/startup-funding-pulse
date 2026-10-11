import { z } from "zod";

/**
 * Server environment, validated with Zod on first access.
 *
 * DATABASE_URL is required from M0. Keys for features not yet built are
 * optional in the schema and asserted at the point of use via `requireEnv`,
 * so a missing key fails loudly in the feature that needs it rather than
 * taking the whole app down. See DECISIONS.md (D-004).
 */
const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .url()
    .refine((v) => v.startsWith("postgres://") || v.startsWith("postgresql://"), {
      message: "DATABASE_URL must be a postgres:// connection string",
    }),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: optionalString,
  GEMINI_EMBEDDING_MODEL: optionalString,
  /** Requests per minute to pace Gemini calls at (default 10, free-tier safe). */
  GEMINI_RPM: optionalString,
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: optionalString,
  CRON_SECRET: optionalString,
  ADMIN_SECRET: optionalString,
  NEWS_API_KEY: optionalString,
  FX_API_URL: optionalString,
  NEXT_PUBLIC_APP_URL: optionalString,
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Report which keys failed, never their values.
    const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${keys}`);
  }
  cached = parsed.data;
  return cached;
}

type OptionalKey = Exclude<keyof Env, "NODE_ENV" | "DATABASE_URL">;

export function requireEnv(key: OptionalKey): string {
  const value = getEnv()[key];
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/** Test-only: clear the memoised env so a test can re-parse process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
