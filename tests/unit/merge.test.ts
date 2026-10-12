import { describe, expect, it } from "vitest";
import { conventionalAmount, mergeReports, stagesCompatible, type SourceReport } from "@/pipeline/merge";

const r = (over: Partial<SourceReport>): SourceReport => ({
  publication: "Inc42",
  publishedAt: new Date("2026-10-08T05:00:00Z"),
  stage: "Series A",
  amountUsd: 10_000_000,
  amountRaw: "$10 Mn",
  amountConfidence: "reported",
  investorsLead: ["Blume Ventures"],
  ...over,
});

describe("mergeReports", () => {
  it("a rupee figure written in millions loses a disagreement to a conventional one (D-087)", () => {
    // Entrackr printed "Rev.Dev raised Rs 11.3 million"; Inc42 reported the same Series A as $11.3 Mn.
    const typo = r({ publication: "Entrackr", publishedAt: new Date("2026-07-11T12:00:00Z"), amountUsd: 118_523, amountRaw: "Rs 11.3 million" });
    const usd = r({ publication: "Inc42", publishedAt: new Date("2026-07-18T04:00:00Z"), amountUsd: 11_300_000, amountRaw: "$11.3 Mn" });
    for (const order of [[typo, usd], [usd, typo]]) {
      const m = mergeReports(order);
      expect(m.amountUsd).toBe(11_300_000);
      expect(m.disputedFields).toContain("amount");
    }
    expect(conventionalAmount("Rs 43 crore")).toBe(true);
    expect(conventionalAmount("₹5 lakh")).toBe(true);
    expect(conventionalAmount("$5.1 Mn")).toBe(true);
    expect(conventionalAmount("Rs 11.3 million")).toBe(false);
    expect(conventionalAmount("INR 2 bn")).toBe(false);
  });

  it("single source: unverified, single-source badges", () => {
    const m = mergeReports([r({})]);
    expect(m.corroborationCount).toBe(1);
    expect(m.isVerified).toBe(false);
    expect(m.badges).toEqual({ amount: "single_source", stage: "single_source", investors: "single_source" });
  });

  it("three agreeing publications: one deal, verified, corroborated", () => {
    const m = mergeReports([
      r({ publication: "Inc42" }),
      r({ publication: "Entrackr", amountUsd: 10_200_000, amountRaw: "₹85 Cr" }),
      r({ publication: "ET Tech" }),
    ]);
    expect(m.corroborationCount).toBe(3);
    expect(m.isVerified).toBe(true);
    expect(m.hasDisputedField).toBe(false);
    expect(m.badges.amount).toBe("corroborated");
    expect(m.amountUsd).toBe(10_000_000);
  });

  it("counts distinct publications, not articles", () => {
    expect(mergeReports([r({ publication: "Inc42" }), r({ publication: "inc42 " })]).corroborationCount).toBe(1);
  });

  it("amount disagreement beyond 10% → disputed, range kept, not verified", () => {
    const m = mergeReports([r({ publication: "A", amountUsd: 10_000_000 }), r({ publication: "B", amountUsd: 15_000_000 })]);
    expect(m.hasDisputedField).toBe(true);
    expect(m.disputedFields).toContain("amount");
    expect(m.amountRaw).toBe("$10.0M–$15.0M (sources disagree)");
    expect(m.isVerified).toBe(false);
  });

  it("reported beats estimated even when estimated is more common", () => {
    const m = mergeReports([
      r({ publication: "A", amountUsd: 12_000_000, amountConfidence: "estimated" }),
      r({ publication: "B", amountUsd: 12_100_000, amountConfidence: "estimated" }),
      r({ publication: "C", amountUsd: 11_500_000, amountConfidence: "reported" }),
    ]);
    expect(m.amountUsd).toBe(11_500_000);
    expect(m.amountConfidence).toBe("reported");
  });

  it("on a confidence tie, the most corroborated value wins", () => {
    const m = mergeReports([
      r({ publication: "A", amountUsd: 5_000_000 }),
      r({ publication: "B", amountUsd: 5_200_000 }),
      r({ publication: "C", amountUsd: 5_100_000 }),
    ]);
    expect(m.amountUsd).toBe(5_000_000);
  });

  it("Undisclosed stage defers to a named stage without dispute", () => {
    const m = mergeReports([r({ publication: "A", stage: "Undisclosed" }), r({ publication: "B", stage: "Seed" })]);
    expect(m.roundStage).toBe("Seed");
    expect(m.hasDisputedField).toBe(false);
  });

  it("conflicting named stages → disputed", () => {
    const m = mergeReports([r({ publication: "A", stage: "Seed" }), r({ publication: "B", stage: "Pre-Series A" })]);
    expect(m.disputedFields).toContain("stage");
  });

  it("no amounts anywhere → undisclosed, not a dispute", () => {
    const m = mergeReports([r({ amountUsd: null, amountRaw: null, amountConfidence: "undisclosed" })]);
    expect(m.amountUsd).toBeNull();
    expect(m.amountConfidence).toBe("undisclosed");
    expect(m.badges.amount).toBe("not_reported");
  });

  it("primary source is the earliest published", () => {
    const m = mergeReports([
      r({ publication: "Late", publishedAt: new Date("2026-10-09") }),
      r({ publication: "Early", publishedAt: new Date("2026-10-07") }),
      r({ publication: "Undated", publishedAt: null }),
    ]);
    expect(m.primaryIndex).toBe(1);
  });

  it("is order-independent for the merged values", () => {
    const reports = [r({ publication: "A", amountUsd: 8_000_000 }), r({ publication: "B", amountUsd: 8_100_000 }), r({ publication: "C", stage: "Undisclosed" })];
    const a = mergeReports(reports);
    const b = mergeReports([...reports].reverse());
    expect(a.roundStage).toBe(b.roundStage);
    expect(a.corroborationCount).toBe(b.corroborationCount);
    expect(a.hasDisputedField).toBe(b.hasDisputedField);
  });
});

describe("stagesCompatible", () => {
  it("treats Undisclosed as compatible with anything", () => {
    expect(stagesCompatible("Seed", "Seed")).toBe(true);
    expect(stagesCompatible("Seed", "Undisclosed")).toBe(true);
    expect(stagesCompatible("Seed", "Series A")).toBe(false);
  });
});
