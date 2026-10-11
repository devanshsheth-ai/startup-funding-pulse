import { describe, expect, it } from "vitest";
import {
  canonicalInvestorName,
  dealId,
  isoWeek,
  mapStage,
  normalizeAmount,
  normalizeCity,
  normalizeCompanyName,
  normalizeDomain,
  resolveAnnouncedDate,
  resolveStage,
} from "@/pipeline/normalize";
import { SECTORS, stageIndex } from "@/lib/taxonomy";

const fx = { usdInr: 96.73, date: "2026-10-09" };

describe("normalizeAmount", () => {
  it("₹120 crore → INR 1.2bn → USD at the dated rate", () => {
    expect(normalizeAmount({ value: 120, currency: "INR", unit: "crore" }, fx)).toEqual({
      amountInr: 1_200_000_000,
      amountUsd: Math.round(1_200_000_000 / 96.73),
      fxRateUsed: 96.73,
      fxRateDate: "2026-10-09",
    });
  });
  it("$5 million → USD 5M and INR at the rate", () => {
    const r = normalizeAmount({ value: 5, currency: "USD", unit: "million" }, fx);
    expect(r?.amountUsd).toBe(5_000_000);
    expect(r?.amountInr).toBe(Math.round(5_000_000 * 96.73));
  });
  it("lakh, billion and absolute units", () => {
    expect(normalizeAmount({ value: 50, currency: "INR", unit: "lakh" }, fx)?.amountInr).toBe(5_000_000);
    expect(normalizeAmount({ value: 1.2, currency: "USD", unit: "billion" }, fx)?.amountUsd).toBe(1_200_000_000);
    expect(normalizeAmount({ value: 250000, currency: "USD", unit: "absolute" }, fx)?.amountUsd).toBe(250_000);
  });
  it("returns null instead of guessing", () => {
    expect(normalizeAmount({ value: null, currency: "INR", unit: "crore" }, fx)).toBeNull();
    expect(normalizeAmount({ value: 5, currency: "USD", unit: "crore" }, fx)).toBeNull();
    expect(normalizeAmount({ value: 5, currency: "EUR", unit: "million" }, fx)).toBeNull();
    expect(normalizeAmount({ value: 5, currency: "INR", unit: "crore" }, null)).toBeNull();
    expect(normalizeAmount({ value: -1, currency: "INR", unit: "crore" }, fx)).toBeNull();
    expect(normalizeAmount({ value: 900, currency: "USD", unit: "billion" }, fx)).toBeNull();
  });
});

describe("stage mapping", () => {
  it.each([
    ["Series A", "Series A"],
    ["series-a round", "Series A"],
    ["Pre-Series A", "Pre-Series A"],
    ["pre series A funding", "Pre-Series A"],
    ["seed round", "Seed"],
    ["Pre-seed", "Pre-seed"],
    ["Series E", "Series D+"],
    ["venture debt", "Debt"],
    ["bridge round", "Bridge"],
    ["Series B1", "Series B"],
    ["pre-IPO", "Pre-IPO"],
    ["angel round", "Angel"],
    ["raised in its Series C funding round", "Series C"],
  ])("%s → %s", (raw, expected) => {
    expect(mapStage(raw)).toBe(expected);
  });
  it("does not confuse Pre-Series A with Series A, or seed with pre-seed", () => {
    expect(mapStage("pre-series a")).toBe("Pre-Series A");
    expect(mapStage("pre-seed round")).toBe("Pre-seed");
  });
  it("unmapped → null; resolveStage falls back to Undisclosed", () => {
    expect(mapStage("mystery tranche")).toBeNull();
    expect(resolveStage(null, "mystery tranche")).toEqual({ stage: "Undisclosed", mapped: false });
    expect(resolveStage("Series A", "whatever")).toEqual({ stage: "Series A", mapped: true });
    expect(resolveStage("Series Z", "seed")).toEqual({ stage: "Seed", mapped: true });
  });
});

describe("normalizeCompanyName", () => {
  it.each([
    ["Zepto Technologies Pvt Ltd", "zepto"],
    ["Khatabook (Kyte Technologies)", "khatabook"],
    ["Sarvam AI Private Limited", "sarvam ai"],
    ["Even Healthcare", "even healthcare"],
    ["The Whole Truth Foods", "the whole truth foods"],
    ["Acme India Labs Inc.", "acme"],
    ["Café Coffee Day", "cafe coffee day"],
    ["D&G Labs", "d and g"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeCompanyName(raw)).toBe(expected);
  });
  it("never strips a name down to nothing", () => {
    expect(normalizeCompanyName("India")).toBe("india");
  });
});

describe("investor canonicalisation", () => {
  it("resolves aliases", () => {
    expect(canonicalInvestorName("Accel Partners India")).toBe("Accel India");
    expect(canonicalInvestorName("Sequoia Capital India")).toBe("Peak XV Partners");
    expect(canonicalInvestorName("  blume  ventures ")).toBe("Blume Ventures");
    expect(canonicalInvestorName("SAIF Partners")).toBe("Elevation Capital");
  });
  it("keeps unknown investors as given and drops non-entities", () => {
    expect(canonicalInvestorName("Some New Capital")).toBe("Some New Capital");
    expect(canonicalInvestorName("existing investors")).toBeNull();
    expect(canonicalInvestorName("angel investors")).toBeNull();
  });
});

describe("normalizeCity", () => {
  it.each([
    ["Bangalore", "Bengaluru"],
    ["Gurugram", "Delhi-NCR"],
    ["Noida", "Delhi-NCR"],
    ["New Delhi", "Delhi-NCR"],
    ["Bengaluru, Karnataka", "Bengaluru"],
    ["Navi Mumbai", "Mumbai"],
    ["Singapore", "Singapore"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeCity(raw)).toBe(expected);
  });
  it("null for empty", () => {
    expect(normalizeCity("")).toBeNull();
    expect(normalizeCity(null)).toBeNull();
  });
});

describe("dates and weeks", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  const pub = new Date("2026-10-09T06:00:00Z");
  it("uses the stated date when plausible", () => {
    expect(resolveAnnouncedDate("2026-10-08", pub, now)).toBe("2026-10-08");
  });
  it("rejects future and implausible stated dates", () => {
    expect(resolveAnnouncedDate("2026-12-01", pub, now)).toBe("2026-10-09");
    expect(resolveAnnouncedDate("2019-01-01", pub, now)).toBe("2026-10-09");
    expect(resolveAnnouncedDate("not-a-date", pub, now)).toBe("2026-10-09");
    expect(resolveAnnouncedDate(null, null, now)).toBeNull();
  });
  it.each([
    ["2026-10-11", "2026-W41"],
    ["2026-10-05", "2026-W41"],
    ["2026-10-04", "2026-W40"],
    ["2026-01-01", "2026-W01"],
    ["2027-01-01", "2026-W53"],
    ["2024-12-30", "2025-W01"],
  ])("isoWeek(%s) = %s", (d, w) => {
    expect(isoWeek(d)).toBe(w);
  });
});

describe("identity", () => {
  it("dealId is deterministic and sensitive to each component", () => {
    const a = dealId("acme", "Series A", "2026-W41");
    expect(a).toBe(dealId("acme", "Series A", "2026-W41"));
    expect(a).not.toBe(dealId("acme", "Series B", "2026-W41"));
    expect(a).not.toBe(dealId("acme", "Series A", "2026-W42"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("normalizeDomain", () => {
    expect(normalizeDomain("https://www.Zepto.com/about")).toBe("zepto.com");
    expect(normalizeDomain("khatabook.com")).toBe("khatabook.com");
    expect(normalizeDomain("not a domain")).toBeNull();
  });
});

describe("taxonomy", () => {
  it("has the PRD sectors and an ordered stage ladder", () => {
    expect(SECTORS).toContain("Fintech");
    expect(SECTORS).toContain("Other");
    expect(stageIndex("Seed")).toBeLessThan(stageIndex("Series A"));
    expect(stageIndex("Debt")).toBe(-1);
  });
});
