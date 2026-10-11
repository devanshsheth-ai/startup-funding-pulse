import { afterEach, describe, expect, it } from "vitest";
import { cosineDistance, parsePgVector, toPgVector } from "@/db/queries/health";
import { getEnv, requireEnv, resetEnvCache } from "@/lib/env";
import { newRunId, redact } from "@/lib/logger";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetEnvCache();
});

describe("env", () => {
  it("rejects a missing DATABASE_URL and names the key, not a value", () => {
    delete process.env.DATABASE_URL;
    resetEnvCache();
    expect(() => getEnv()).toThrow(/DATABASE_URL/);
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    process.env.DATABASE_URL = "https://example.com";
    resetEnvCache();
    expect(() => getEnv()).toThrow(/DATABASE_URL/);
  });

  it("treats empty optional keys as missing and requireEnv fails loudly", () => {
    process.env.DATABASE_URL = "postgresql://u:p@host.neon.tech/db";
    process.env.GEMINI_API_KEY = "";
    resetEnvCache();
    expect(getEnv().GEMINI_API_KEY).toBeUndefined();
    expect(() => requireEnv("GEMINI_API_KEY")).toThrow(/GEMINI_API_KEY/);
  });
});

describe("logger redaction", () => {
  it("redacts secret-named keys", () => {
    expect(redact({ api_key: "abc", CRON_SECRET: "x", nested: { password: "p" } }, [])).toEqual({
      api_key: "[redacted]",
      CRON_SECRET: "[redacted]",
      nested: { password: "[redacted]" },
    });
  });

  it("scrubs known secret values and connection-string credentials from strings", () => {
    const out = redact(
      { msg: "failed with key sk-live-123456789 at postgresql://user:pw@ep-x.neon.tech/db" },
      ["sk-live-123456789"],
    );
    expect(out).toEqual({ msg: "failed with key [redacted] at postgresql://[redacted]@ep-x.neon.tech/db" });
  });

  it("keeps usage counts but hides credential tokens", () => {
    expect(redact({ tokens: 112, gemini_tokens: 9, token: "t", access_token: "a", authToken: "b" }, [])).toEqual({
      tokens: 112,
      gemini_tokens: 9,
      token: "[redacted]",
      access_token: "[redacted]",
      authToken: "[redacted]",
    });
  });

  it("serialises errors without stacks", () => {
    expect(redact(new Error("boom"), [])).toEqual({ name: "Error", message: "boom" });
  });
});

describe("run id", () => {
  it("is time-prefixed and unique", () => {
    const a = newRunId(new Date("2026-10-11T06:00:00.000Z"));
    expect(a).toMatch(/^run_20261011T060000_[0-9a-f]{8}$/);
    expect(newRunId()).not.toEqual(newRunId());
  });
});

describe("pgvector helpers", () => {
  it("round-trips a vector literal", () => {
    const v = [0.125, -0.5, 0.75];
    expect(parsePgVector(toPgVector(v))).toEqual(v);
    expect(parsePgVector("[]")).toEqual([]);
  });

  it("rejects malformed literals", () => {
    expect(() => parsePgVector("0.1,0.2")).toThrow();
    expect(() => parsePgVector("[0.1,abc]")).toThrow();
  });

  it("computes cosine distance", () => {
    expect(cosineDistance([1, 0], [1, 0])).toBeCloseTo(0);
    expect(cosineDistance([1, 0], [0, 1])).toBeCloseTo(1);
    expect(() => cosineDistance([1], [1, 2])).toThrow();
  });
});
