import { describe, expect, it } from "vitest";
import golden from "../fixtures/golden-funding.json";
import snapshot from "../fixtures/pipeline-snapshot.json";
import { goldenFileSchema, scoreGoldenCase, summariseGolden } from "@/pipeline/golden";
import { mergeReports, type SourceReport } from "@/pipeline/merge";
import { buildDealCandidate, canonicalInvestorName, dealId, normalizeCompanyName, normalizeInvestorKey, resolveAnnouncedDate, resolveStage, toIsoDate } from "@/pipeline/normalize";
import { extractedDealSchema, type ExtractedDeal } from "@/pipeline/schemas";

/**
 * Integration and idempotency tests on a fixed snapshot of real data (PRD §25):
 * 25 deals with all 58 of their source reports, exported by
 * `npm run fixtures`. They exercise normalisation → deterministic deal ids →
 * merge exactly as the pipeline runs them, without a database.
 */

interface SnapSource {
  publication: string;
  publishedAt: string | null;
  stage: string | null;
  amountUsd: number | null;
  amountRaw: string | null;
  amountConfidence: string | null;
  investorsLead: string[];
  payload: unknown;
}
interface SnapDeal {
  deal: { id: string; company: string; round_stage: string; amount_usd: number | null; corroboration_count: number; is_verified: boolean; has_disputed_field: boolean; disputed_fields: string[]; iso_week: string };
  sources: SnapSource[];
}
const deals = (snapshot as { deals: SnapDeal[] }).deals;
const report = (s: SnapSource): SourceReport => ({
  publication: s.publication,
  publishedAt: s.publishedAt ? new Date(s.publishedAt) : null,
  stage: s.stage,
  amountUsd: s.amountUsd,
  amountRaw: s.amountRaw,
  amountConfidence: s.amountConfidence,
  investorsLead: s.investorsLead,
});

describe("integration: stored source reports → merged deals (Stage D)", () => {
  it("covers a real funnel: 58 source reports collapse into 25 deals", () => {
    const sources = deals.reduce((n, d) => n + d.sources.length, 0);
    expect(deals).toHaveLength(25);
    expect(sources).toBe(58);
    expect(1 - deals.length / sources).toBeGreaterThan(0.5);
  });

  it("merging each deal's reports reproduces the stored stage, amount, corroboration and verification", () => {
    for (const d of deals) {
      const m = mergeReports(d.sources.map(report));
      expect(m.roundStage, d.deal.company).toBe(d.deal.round_stage);
      if (d.deal.amount_usd === null) expect(m.amountUsd, d.deal.company).toBeNull();
      else expect(Math.abs((m.amountUsd ?? 0) - d.deal.amount_usd) / d.deal.amount_usd, d.deal.company).toBeLessThan(0.01);
      expect(m.corroborationCount, d.deal.company).toBe(d.deal.corroboration_count);
      expect(m.isVerified, d.deal.company).toBe(d.deal.is_verified);
      expect([...m.disputedFields].sort(), d.deal.company).toEqual([...d.deal.disputed_fields].sort());
    }
  });

  it("every stored extraction still validates against the current schema", () => {
    for (const d of deals) for (const s of d.sources) expect(extractedDealSchema.safeParse(s.payload).success, d.deal.company).toBe(true);
  });
});

describe("idempotency (re-running a stage changes nothing)", () => {
  it("merging is order-independent and repeat reports from the same publication do not inflate corroboration", () => {
    for (const d of deals) {
      const reports = d.sources.map(report);
      const a = mergeReports(reports);
      const b = mergeReports([...reports].reverse());
      const c = mergeReports([...reports, ...reports]);
      expect({ s: b.roundStage, a: b.amountUsd, n: b.corroborationCount }, d.deal.company).toEqual({ s: a.roundStage, a: a.amountUsd, n: a.corroborationCount });
      expect(c.corroborationCount, d.deal.company).toBe(a.corroborationCount);
    }
  });

  it("building a candidate twice from the same extraction gives the same deterministic deal id", () => {
    let built = 0;
    for (const d of deals) {
      for (const s of d.sources) {
        const p = extractedDealSchema.parse(s.payload);
        const date = resolveAnnouncedDate(p.announced_date, s.publishedAt ? new Date(s.publishedAt) : null, new Date("2026-10-12T00:00:00Z"));
        if (!date) continue;
        const opts = { announcedDate: date, fx: { usdInr: 96, date }, today: toIsoDate(new Date("2026-10-12T00:00:00Z")) };
        const one = buildDealCandidate(p, opts);
        const two = buildDealCandidate(p, opts);
        if (!one.ok || !two.ok) continue;
        built++;
        expect(dealId(one.value.normalizedName, one.value.roundStage, one.value.isoWeek)).toBe(dealId(two.value.normalizedName, two.value.roundStage, two.value.isoWeek));
      }
    }
    expect(built).toBeGreaterThan(40);
  });
});

describe("golden file (shape and scoring rules; the Gemini run is `npm run golden`)", () => {
  const file = goldenFileSchema.parse(golden);
  const norms = { normalizeCompanyName, normalizeInvestorKey, canonicalInvestorName, resolveStage };
  it("has 20 cases, each with a source URL and agreed fields", () => {
    expect(file.cases).toHaveLength(20);
    for (const c of file.cases) expect(c.article.url).toMatch(/^https?:\/\//);
  });
  it("a perfect extraction passes; a wrong amount, stage or missing company fails", () => {
    const c = file.cases[0]!;
    const perfect = {
      company_name: c.expected.company,
      company_aliases: [],
      round_stage: c.expected.stage,
      stage_raw: null,
      amount: { value: c.expected.amountUsd, currency: "USD", unit: "absolute", raw: null },
      investors_lead: c.expected.leads,
    } as unknown as ExtractedDeal;
    expect(scoreGoldenCase(c, [perfect], norms)).toMatchObject({ found: true, stage: true, amount: true, leads: true });
    const off = { ...perfect, amount: { ...perfect.amount, value: c.expected.amountUsd * 1.5 }, round_stage: "Grant" } as ExtractedDeal;
    expect(scoreGoldenCase(c, [off], norms)).toMatchObject({ found: true, stage: false, amount: false });
    expect(scoreGoldenCase(c, [], norms).found).toBe(false);
    expect(summariseGolden([scoreGoldenCase(c, [perfect], norms)]).pass).toBe(true);
  });
});
