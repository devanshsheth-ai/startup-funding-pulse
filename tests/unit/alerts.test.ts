import { describe, expect, it } from "vitest";
import { momentumState } from "@/pipeline/alerts/engine";
import { bySeverity, decide, dedupeKey, inQuietHours, type PolicyState, type TriggerKey } from "@/pipeline/alerts/policy";
import { dispatch } from "@/pipeline/dispatch";
import { collectIsolated } from "@/pipeline/ingest/collect";

const NOW = Date.parse("2026-10-12T03:00:00Z"); // 08:30 IST
const state = (o: Partial<PolicyState> = {}): PolicyState => ({
  enabled: true,
  triggersEnabled: { competitor_raise: true },
  severityThreshold: "high",
  quietHours: ["22:00", "07:00"],
  localTime: "08:30",
  maxImmediatePerDay: 3,
  sentToday: 0,
  lastImmediateByPortfolio: new Map(),
  nowMs: NOW,
  ...o,
});
const c = (triggerKey: TriggerKey, portfolioId: number | null = 1, amountUsd: number | null = null) => ({ triggerKey, portfolioId, amountUsd });

describe("dedupe key (§15.2 rule 1)", () => {
  const base = { profileId: "aarav-familyoffice", triggerKey: "competitor_raise" as const, portfolioId: 4, dealId: "d1", eventId: null, subject: null };
  it("is identical for the same event however many publications report it", () => {
    // Five reports of one round merge into one deal id upstream, so they share one key.
    expect(new Set(Array.from({ length: 5 }, () => dedupeKey(base))).size).toBe(1);
  });
  it("differs by profile, trigger, tracked company and deal", () => {
    const keys = [base, { ...base, profileId: "x" }, { ...base, triggerKey: "same_layer_raise" as const }, { ...base, portfolioId: 5 }, { ...base, dealId: "d2" }].map(dedupeKey);
    expect(new Set(keys).size).toBe(5);
  });
  it("falls back to the event, then the subject, when there is no deal", () => {
    expect(dedupeKey({ ...base, dealId: null, eventId: "e1" })).not.toBe(dedupeKey({ ...base, dealId: null, eventId: "e2" }));
    expect(dedupeKey({ ...base, dealId: null, subject: "2026-W41" })).not.toBe(dedupeKey({ ...base, dealId: null, subject: "2026-W42" }));
  });
});

describe("hygiene rules", () => {
  it("quiet hours cross midnight", () => {
    expect(inQuietHours("23:30", ["22:00", "07:00"])).toBe(true);
    expect(inQuietHours("06:59", ["22:00", "07:00"])).toBe(true);
    expect(inQuietHours("07:00", ["22:00", "07:00"])).toBe(false);
    expect(inQuietHours("13:00", ["12:00", "14:00"])).toBe(true);
    expect(inQuietHours("13:00", ["09:00", "09:00"])).toBe(false);
  });
  it("queues immediate alerts inside quiet hours", () => {
    expect(decide(c("competitor_raise"), state({ localTime: "04:30" })).status).toBe("queued");
  });
  it("suppresses when alerts or the trigger are switched off", () => {
    expect(decide(c("competitor_raise"), state({ enabled: false }))).toMatchObject({ status: "suppressed" });
    expect(decide(c("competitor_raise"), state({ triggersEnabled: { competitor_raise: false } }))).toMatchObject({ status: "suppressed" });
  });
  it("holds below-threshold severities for the digest instead of dropping them (D-072)", () => {
    expect(decide(c("adjacency_cluster"), state()).status).toBe("batched");
    expect(decide(c("adjacency_cluster"), state({ severityThreshold: "medium" })).status).toBe("pending");
  });
  it("applies the delivery rule: digest-only triggers and small same-layer raises wait", () => {
    expect(decide(c("competitor_shutdown"), state({ severityThreshold: "info" })).status).toBe("batched");
    expect(decide(c("same_layer_raise", 1, 4_000_000), state()).status).toBe("batched");
    expect(decide(c("same_layer_raise", 1, null), state()).status).toBe("batched");
    expect(decide(c("same_layer_raise", 1, 6_000_000), state()).status).toBe("pending");
  });
  it("enforces the daily cap, spending it on the most severe first", () => {
    const st = state();
    const order = bySeverity([c("same_layer_raise", 9, 9e6), c("competitor_raise", 1), c("watchlist_raise", null), c("competitor_raise", 2), c("competitor_raise", 3)]);
    const out = order.map((x) => decide(x, st).status);
    expect(out).toEqual(["pending", "pending", "pending", "batched", "batched"]);
    expect(st.sentToday).toBe(3);
  });
  it("cooldown: one non-critical immediate alert per tracked company per 24 h; critical bypasses", () => {
    const st = state({ lastImmediateByPortfolio: new Map([[1, NOW - 3_600_000]]) });
    expect(decide(c("same_layer_raise", 1, 9e6), st)).toMatchObject({ status: "batched", reason: expect.stringContaining("cooldown") });
    expect(decide(c("competitor_raise", 1), st).status).toBe("pending");
    const old = state({ lastImmediateByPortfolio: new Map([[1, NOW - 25 * 3_600_000]]) });
    expect(decide(c("same_layer_raise", 1, 9e6), old).status).toBe("pending");
  });
  it("releasing a queued alert re-checks only quiet hours, cooldown and the cap", () => {
    expect(decide(c("competitor_raise"), state({ enabled: false }), true).status).toBe("pending");
    expect(decide(c("competitor_raise"), state({ localTime: "06:00" }), true).status).toBe("queued");
    expect(decide(c("competitor_raise"), state({ sentToday: 3 }), true).status).toBe("batched");
  });
});

describe("sector momentum flip states", () => {
  it("classifies against ±1σ", () => {
    expect(momentumState(1.4)).toBe("accelerating");
    expect(momentumState(-1)).toBe("cooling");
    expect(momentumState(0.5)).toBe("steady");
  });
});

describe("graceful degradation", () => {
  it("a stage that throws mid-run is skipped and later stages still run", async () => {
    const ran: string[] = [];
    const stages = [
      { key: "collect", run: async () => (ran.push("collect"), { processed: 3, next_cursor: null }) },
      { key: "extract", run: async (): Promise<never> => { throw new Error("Gemini 503"); } },
      { key: "score", run: async () => (ran.push("score"), { processed: 1, next_cursor: null }) },
      { key: "deliver", run: async () => (ran.push("deliver"), { processed: 1, next_cursor: null }) },
    ];
    const r = await dispatch("run_test", { stageIndex: 0, cursor: null }, Date.now(), stages);
    expect(r.done).toBe(true);
    expect(ran).toEqual(["collect", "score", "deliver"]);
    expect(r.steps.find((s) => s.stage === "extract")?.error).toContain("Gemini 503");
  });
  it("a source that dies mid-collection becomes an error outcome, not an aborted run", async () => {
    const ok = await collectIsolated({ id: 1, name: "Inc42" }, async (s) => ({ sourceId: s.id, name: s.name, status: "ok", fetched: 10, tooOld: 0, inserted: 4, duplicates: 6 }));
    const dead = await collectIsolated({ id: 2, name: "YourStory" }, async () => {
      throw new Error("connection reset mid-read");
    });
    expect(ok.status).toBe("ok");
    expect(dead).toMatchObject({ sourceId: 2, status: "error", error: "connection reset mid-read" });
  });
});
