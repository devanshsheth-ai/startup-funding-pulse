import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test for 12 Oct 2026: a slow digest used up the stage budget and
 * the remaining profile was silently skipped. The stage must hand the rest to
 * the next invocation via its cursor.
 */

const profile = (id: string) => ({
  id,
  lastDigestSentAt: null,
  config: { delivery: { mode: "weekly", days: ["monday"], send_hour: "06:30", timezone: "Asia/Kolkata", recipients: [], min_deals_to_send: 0 } },
});

vi.mock("@/pipeline/score", () => ({ loadProfiles: async () => [profile("a"), profile("b"), profile("c")] }));
vi.mock("@/lib/run-log", () => ({ startStage: async () => ({ counters: { itemsIn: 0, itemsOut: 0, geminiCalls: 0, geminiTokens: 0 }, finish: async () => undefined }) }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ RESEND_API_KEY: "x", EMAIL_FROM: "x" }), requireEnv: () => "x" }));
vi.mock("@/pipeline/digest", () => ({ buildDigest: vi.fn(), loadProfileWithName: vi.fn(), persistDigest: vi.fn() }));
vi.mock("@/emails/render", () => ({ renderDigest: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn() }));

describe("deliver stage continuation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T01:15:00Z")); // Monday 06:45 IST: all three due
  });

  it("returns a cursor at the first profile it had no time for, and resumes from it", async () => {
    const deliver = await import("@/pipeline/deliver");
    const first = await deliver.runDeliver({ runId: "r", cursor: null, deadline: Date.now() - 1 });
    expect(first.next_cursor).toBe("0");
    const resumed = await deliver.runDeliver({ runId: "r", cursor: "2", deadline: Date.now() - 1 });
    expect(resumed.next_cursor).toBe("2");
  });

  it("finishes with a null cursor when every remaining profile is not due", async () => {
    vi.setSystemTime(new Date("2026-10-13T01:15:00Z")); // Tuesday: weekly profiles not due
    const deliver = await import("@/pipeline/deliver");
    const r = await deliver.runDeliver({ runId: "r", cursor: null, deadline: Date.now() - 1 });
    expect(r.next_cursor).toBeNull();
    expect(r.processed).toBe(3);
  });
});
