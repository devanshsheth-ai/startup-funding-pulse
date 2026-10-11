import { describe, expect, it } from "vitest";
import aarav from "../../seed/profile-aarav.json";
import { mandateConfigSchema } from "@/config/profile";
import { DETECTORS, type DetectorKey } from "@/config/detectors";
import { addWeeks, latestCompletedWeek, weeksBetween, type DetectionInput } from "@/db/queries/detection";
import { DETECTOR_FUNCTIONS } from "@/pipeline/detect";
import { baselineList, type DetectContext } from "@/pipeline/detect/types";
import { normalCdf } from "@/db/queries/aggregates";

const cfg = mandateConfigSchema.parse(aarav.config);
const W = "2026-W41";
const NOW = new Date("2026-10-12T06:00:00Z");

function input(over: Partial<DetectionInput> = {}): DetectionInput {
  return {
    targetWeek: W,
    baseFrom: addWeeks(W, -8),
    earliestWeek: "2026-W28",
    sectorWeekly: [],
    stageWeekly: [],
    cityWeekly: [],
    concentration: [],
    stageMedians: [],
    investorFirsts: [],
    coinvest: [],
    roundPairs: [],
    outliers: [],
    founders: [],
    clusterPairs: [],
    corpusP99: 0.9,
    corpusPairs: 1000,
    lastDealBySector: new Map(),
    labels: new Map(),
    ...over,
  };
}
const ctx = (inp: DetectionInput, history = 13): DetectContext => ({ input: inp, historyWeeks: history, baselineWeeks: baselineList(W, history, 8), config: cfg, now: NOW });
const sectorRow = (week: string, sector: string, n: number) => ({ week, sector, n, capital: n * 1e6, deal_ids: Array.from({ length: n }, (_, i) => `${sector}-${week}-${i}`) });
const flatBaseline = (sector: string, n: number) => baselineList(W, 13, 8).map((w) => sectorRow(w, sector, n));

describe("ISO week helpers", () => {
  it("steps, measures and finds the last completed week", () => {
    expect(addWeeks("2026-W41", -1)).toBe("2026-W40");
    expect(addWeeks("2026-W01", -1)).toBe("2025-W52");
    expect(weeksBetween("2026-W28", "2026-W41")).toBe(13);
    expect(latestCompletedWeek(new Date("2026-10-11T12:00:00Z"))).toBe("2026-W41"); // Sunday
    expect(latestCompletedWeek(new Date("2026-10-12T06:00:00Z"))).toBe("2026-W41"); // Monday
    expect(latestCompletedWeek(new Date("2026-10-17T06:00:00Z"))).toBe("2026-W41"); // Saturday
  });
});

describe("history gate (b_min) — the gate that breaks young databases", () => {
  it("every detector is suppressed, with a reason, at 1 week of history", () => {
    for (const k of Object.keys(DETECTOR_FUNCTIONS) as DetectorKey[]) {
      const o = DETECTOR_FUNCTIONS[k](ctx(input(), 1));
      expect(o.status, k).toBe("suppressed");
      expect(o.reason, k).toMatch(/history/);
      expect(o.findings, k).toEqual([]);
    }
  });
  it("suppresses exactly below b_min and evaluates at b_min", () => {
    for (const k of Object.keys(DETECTORS) as DetectorKey[]) {
      const b = DETECTORS[k].bMin;
      expect(DETECTOR_FUNCTIONS[k](ctx(input(), b - 1)).status, k).toBe("suppressed");
      expect(DETECTOR_FUNCTIONS[k](ctx(input(), b)).reason, k).not.toMatch(/weeks? of history; needs/);
    }
  });
});

describe("sector_momentum", () => {
  it("fires on a spike that clears n_min and 1.5σ", () => {
    const o = DETECTOR_FUNCTIONS.sector_momentum(ctx(input({ sectorWeekly: [...flatBaseline("Fintech", 2), sectorRow(W, "Fintech", 6)] })));
    expect(o.status).toBe("fired");
    expect(o.findings[0]?.subject).toBe("Fintech:accelerating");
    expect(o.findings[0]?.statement).toContain("6 deals this week vs 2/week");
  });
  it("stays quiet below n_min even with a large z (2 deals from a zero baseline)", () => {
    const o = DETECTOR_FUNCTIONS.sector_momentum(ctx(input({ sectorWeekly: [...flatBaseline("Agritech", 0), sectorRow(W, "Agritech", 2)] })));
    expect(o.status).toBe("quiet");
  });
  it("detects cooling against a busy baseline", () => {
    const o = DETECTOR_FUNCTIONS.sector_momentum(ctx(input({ sectorWeekly: [...flatBaseline("Fintech", 6)] })));
    expect(o.findings.map((f) => f.subject)).toEqual(["Fintech:cooling"]);
  });
});

describe("investor_rotation — each of the four guards blocks on its own", () => {
  const first = (o: Partial<DetectionInput["investorFirsts"][number]> = {}) => ({
    investor_id: 1, investor: "Blume Ventures", sector: "Healthtech", deal_id: "d1", deal_count: 5,
    first_seen: new Date("2026-07-10T00:00:00Z"), prior_in_sector: 0, ...o,
  });
  const run = (f: ReturnType<typeof first>, history = 13) => DETECTOR_FUNCTIONS.investor_rotation(ctx(input({ investorFirsts: [f] }), history));
  it("fires when all four pass", () => {
    expect(run(first()).findings).toHaveLength(1);
  });
  it("guard 1: fewer than 3 deals in the database", () => {
    const o = run(first({ deal_count: 2 }));
    expect(o.findings).toHaveLength(0);
    expect(o.guardLog?.[0]).toContain("guard 1 failed");
  });
  it("guard 2: has prior deals in the sector", () => {
    expect(run(first({ prior_in_sector: 1 })).findings).toHaveLength(0);
  });
  it("guard 3: database history under 8 weeks", () => {
    const o = run(first(), 7);
    expect(o.status).toBe("suppressed");
    expect(o.guardLog?.[0]).toContain("guard 3");
  });
  it("guard 4: first seen less than 8 weeks ago", () => {
    const o = run(first({ first_seen: new Date("2026-09-20T00:00:00Z") }));
    expect(o.findings).toHaveLength(0);
    expect(o.guardLog?.[0]).toContain("guard 4 failed");
  });
});

describe("other gates", () => {
  it("syndicate: needs 3 co-investments, lift ≥ 2, and a deal this week", () => {
    const pair = { a: "A", b: "B", together: 3, a_deals: 4, b_deals: 4, total: 100, deal_ids: ["x"], in_target: true };
    expect(DETECTOR_FUNCTIONS.syndicate_formation(ctx(input({ coinvest: [pair] }))).status).toBe("fired");
    expect(DETECTOR_FUNCTIONS.syndicate_formation(ctx(input({ coinvest: [{ ...pair, together: 2 }] }))).status).toBe("quiet");
    expect(DETECTOR_FUNCTIONS.syndicate_formation(ctx(input({ coinvest: [{ ...pair, a_deals: 40, b_deals: 40 }] }))).status).toBe("quiet");
    expect(DETECTOR_FUNCTIONS.syndicate_formation(ctx(input({ coinvest: [{ ...pair, in_target: false }] }))).status).toBe("quiet");
  });
  it("outlier: n ≥ 8 bucket, stage fallback, else suppressed", () => {
    const base = { deal_id: "d", stage: "Seed", sector: "Fintech", amount: 50_000_000, b_n: 9, b_mean: 6, b_sd: 0.3, s_n: 20, s_mean: 6, s_sd: 0.3 };
    expect(DETECTOR_FUNCTIONS.outlier_deal(ctx(input({ outliers: [base] }))).status).toBe("fired");
    expect(DETECTOR_FUNCTIONS.outlier_deal(ctx(input({ outliers: [{ ...base, b_n: 4 }] }))).findings[0]?.statBasis.bucket).toBe("Seed (all sectors)");
    expect(DETECTOR_FUNCTIONS.outlier_deal(ctx(input({ outliers: [{ ...base, b_n: 4, s_n: 7 }] }))).status).toBe("suppressed");
  });
  it("sector silence counts consecutive empty weeks for mandate sectors only", () => {
    const rows = cfg.sectors_core.filter((c) => c.name !== "Healthtech").map((c) => sectorRow(W, c.name, 1));
    rows.push(sectorRow(addWeeks(W, -4), "Healthtech", 2));
    const o = DETECTOR_FUNCTIONS.sector_silence(ctx(input({ sectorWeekly: rows })));
    expect(o.findings.map((f) => [f.subject, f.effectSize])).toEqual([["Healthtech", 4]]);
  });
  it("cheque inflation needs ≥4 priced deals on both sides and a 25% move", () => {
    const m = { stage: "Seed", t_n: 4, t_median: 3_000_000, b_n: 10, b_median: 2_000_000, t_ids: ["a"] };
    expect(DETECTOR_FUNCTIONS.cheque_inflation(ctx(input({ stageMedians: [m] }))).status).toBe("fired");
    expect(DETECTOR_FUNCTIONS.cheque_inflation(ctx(input({ stageMedians: [{ ...m, t_n: 3 }] }))).status).toBe("quiet");
    expect(DETECTOR_FUNCTIONS.cheque_inflation(ctx(input({ stageMedians: [{ ...m, t_median: 2_200_000 }] }))).status).toBe("quiet");
  });
  it("follow-on compression is suppressed (not quiet) with too few round pairs", () => {
    const o = DETECTOR_FUNCTIONS.followon_compression(ctx(input({ roundPairs: [{ deal_id: "a", later_week: W, gap_months: 10 }] })));
    expect(o.status).toBe("suppressed");
    expect(o.reason).toContain("round pairs");
  });
  it("thesis clustering needs cohesion above the corpus percentile, not just 0.75", () => {
    const pairs = [
      { a: "a", b: "b", sim: 0.86 },
      { a: "a", b: "c", sim: 0.86 },
      { a: "b", b: "c", sim: 0.86 },
    ];
    expect(DETECTOR_FUNCTIONS.thesis_clustering(ctx(input({ clusterPairs: pairs, corpusP99: 0.92 }))).status).toBe("quiet");
    expect(DETECTOR_FUNCTIONS.thesis_clustering(ctx(input({ clusterPairs: pairs, corpusP99: 0.8 }))).status).toBe("fired");
  });
});

describe("normalCdf (market temperature mapping)", () => {
  it("maps z to 0..1", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 5);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});
