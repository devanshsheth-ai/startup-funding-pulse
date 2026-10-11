import { describe, expect, it } from "vitest";
import aarav from "../../seed/profile-aarav.json";
import { mandateConfigSchema } from "@/config/profile";
import { normalizeInvestorKey } from "@/pipeline/normalize";
import { chequeFit, exclusionReason, geographyFit, recencyFit, scoreDeal, stageFit, tierFor, type DealFacts, type ScoringContext } from "@/pipeline/rubric";

const cfg = mandateConfigSchema.parse(aarav.config);
const deal = (o: Partial<DealFacts> = {}): DealFacts => ({
  companyName: "Acme",
  description: "Embedded working-capital credit for B2B marketplaces",
  sector: "Fintech",
  subSector: "SME lending",
  stage: "Series A",
  priorRoundStage: null,
  amountUsd: 8_000_000,
  city: "Bengaluru",
  announcedDate: "2026-10-09",
  corroborationCount: 2,
  isVerified: true,
  investors: [{ name: "Blume Ventures", role: "lead" }],
  ...o,
});
const ctx = (o: Partial<ScoringContext> = {}): ScoringContext => ({
  config: cfg,
  sectorFit: { fit: 0.93, reason: "Fintech → SME lending (primary match)" },
  watchedInvestors: new Map([[normalizeInvestorKey("Blume Ventures"), "Blume Ventures"]]),
  watchlistCompany: null,
  adjacency: null,
  investorFirstMove: null,
  chequePercentile: { value: 0.78, bucket: "Series A × Fintech", n: 14 },
  investorTier: { value: 0.9, investor: "Blume Ventures" },
  window: { start: "2026-10-04", end: "2026-10-11" },
  normalizeInvestor: normalizeInvestorKey,
  ...o,
});

describe("scoreDeal — PRD §11.5 worked example shape", () => {
  it("scores every component and applies a same-layer override", () => {
    const s = scoreDeal(deal(), ctx({ adjacency: { relationship: "same_layer", portfolioName: "Khatabook", rationale: "r" } }));
    expect(s.excluded).toBeNull();
    expect(s.components?.sector_fit.points).toBe(27.9);
    expect(s.components?.stage_fit).toMatchObject({ points: 20, detail: "Series A, in mandate" });
    expect(s.components?.cheque_fit.points).toBe(10);
    expect(s.components?.tracked_investor).toMatchObject({ points: 12, detail: "Blume Ventures (lead), tracked" });
    expect(s.components?.geography_fit.points).toBe(5);
    expect(s.overrides).toEqual([{ key: "adjacency_same_layer", points: 25, detail: "Same layer as Khatabook (tracked company)" }]);
    expect(s.raw_total).toBeGreaterThan(100);
    expect(s.clamped_total).toBe(100);
    expect(s.tier).toBe("act_now");
    expect(s.reason).toContain("Same layer as Khatabook");
  });

  it("discounts single-source unverified deals by 0.85", () => {
    const a = scoreDeal(deal({ corroborationCount: 1, isVerified: false }), ctx({ chequePercentile: null, investorTier: null }));
    const b = scoreDeal(deal({ corroborationCount: 2, isVerified: true }), ctx({ chequePercentile: null, investorTier: null }));
    expect(a.confidence_multiplier).toBe(0.85);
    expect(a.raw_total).toBeLessThan(b.raw_total);
  });

  it("watchlist override is +40 and labels the company", () => {
    const s = scoreDeal(deal({ sector: "Agritech" }), ctx({ sectorFit: { fit: 0.3, reason: "watch sector" }, watchlistCompany: "Vegrow" }));
    expect(s.overrides[0]).toEqual({ key: "watchlist", points: 40, detail: "Vegrow is on the watchlist" });
  });

  it("mandate_score excludes ecosystem significance (serendipity gate)", () => {
    const s = scoreDeal(deal(), ctx());
    expect(s.mandate_score).toBeCloseTo(s.raw_total / s.confidence_multiplier - s.significance_score, 0);
  });
});

describe("hard exclusion filter", () => {
  it("archives excluded keywords before scoring", () => {
    const s = scoreDeal(deal({ sector: "Gaming", subSector: "fantasy sports", description: "Fantasy sports app" }), ctx());
    expect(s).toMatchObject({ total: 0, tier: "archive", components: null });
    expect(s.excluded?.reason).toContain("fantasy sports");
  });
  it("does not fire on substrings of other words", () => {
    expect(exclusionReason({ sector: "Fintech", subSector: "payments", description: "Cards for schools-of-thought", companyName: "Nftrack" }, cfg)).toBeNull();
  });
  it("casual gaming is not excluded, real-money gaming is", () => {
    expect(exclusionReason({ sector: "Gaming", subSector: "casual mobile games", description: null, companyName: "X" }, cfg)).toBeNull();
    expect(exclusionReason({ sector: "Gaming", subSector: "real-money gaming", description: null, companyName: "X" }, cfg)).not.toBeNull();
  });
});

describe("components", () => {
  it("stage fit ladder", () => {
    expect(stageFit({ stage: "Seed", priorRoundStage: null }, cfg, 20).points).toBe(20);
    expect(stageFit({ stage: "Series B", priorRoundStage: null }, cfg, 20).points).toBe(10);
    expect(stageFit({ stage: "Series C", priorRoundStage: null }, cfg, 20).points).toBe(4);
    expect(stageFit({ stage: "Growth", priorRoundStage: null }, cfg, 20).points).toBe(0);
    expect(stageFit({ stage: "Undisclosed", priorRoundStage: null }, cfg, 20)).toMatchObject({ points: 0, detail: "Round not named in the article" });
    expect(stageFit({ stage: "Debt", priorRoundStage: "Series A" }, cfg, 20).points).toBe(20);
    expect(stageFit({ stage: "Bridge", priorRoundStage: null }, cfg, 20).points).toBe(10);
  });
  it("cheque fit: band, ±50%, outside, undisclosed neutral", () => {
    expect(chequeFit(5_000_000, cfg, 10).points).toBe(10);
    expect(chequeFit(300_000, cfg, 10).points).toBe(5);
    expect(chequeFit(25_000_000, cfg, 10).points).toBe(5);
    expect(chequeFit(100_000, cfg, 10).points).toBe(0);
    expect(chequeFit(null, cfg, 10)).toMatchObject({ points: 4 });
  });
  it("geography and recency", () => {
    expect(geographyFit("Mumbai", cfg, 5).points).toBe(5);
    expect(geographyFit("Pune", cfg, 5).points).toBe(3);
    expect(geographyFit("Indore", cfg, 5).points).toBe(1);
    expect(geographyFit(null, cfg, 5).points).toBe(0);
    const win = { start: "2026-10-04", end: "2026-10-11" };
    expect(recencyFit("2026-10-11", win, 5).points).toBe(5);
    expect(recencyFit("2026-10-04", win, 5).points).toBe(0);
    expect(recencyFit("2026-09-01", win, 5).detail).toBe("Before the current digest window");
  });
  it("tiers", () => {
    expect([85, 65, 45, 25, 5].map((s) => tierFor(s, cfg))).toEqual(["act_now", "high", "relevant", "context", "archive"]);
  });
});

describe("profile seeds", () => {
  it("all three validate, keep keywords specific and the disclosure label", async () => {
    const { profileSeedSchema } = await import("@/config/profile");
    for (const f of ["profile-aarav.json", "profile-fintech-seed-fund.json", "profile-consumer-syndicate.json"]) {
      const p = profileSeedSchema.parse((await import(`../../seed/${f}`)).default);
      expect(p.portfolio.every((c) => c.relationship_type === "simulated_holding")).toBe(true);
    }
  });
});
