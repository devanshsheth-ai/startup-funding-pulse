import { describe, expect, it } from "vitest";
import { buildDealCandidate, buildEventCandidate, normalizePartialDate } from "@/pipeline/normalize";
import type { ExtractedDeal, ExtractedEvent } from "@/pipeline/schemas";

const nullMoney = { value: null, currency: null, unit: null, raw: null };
const deal = (over: Partial<ExtractedDeal> = {}): ExtractedDeal => ({
  company_name: "Acme Technologies Pvt Ltd",
  company_aliases: ["Acme"],
  company_description: "B2B payments API for kirana distributors.",
  domain: "www.acme.in",
  round_stage: null,
  stage_raw: "pre-Series A round",
  amount: { value: 40, currency: "INR", unit: "crore", raw: "₹40 crore" },
  amount_confidence: "reported",
  announced_date: null,
  sector_primary: "Fintech",
  sector_secondary: ["Fintech", "B2B SaaS"],
  sub_sector: "B2B payments",
  business_model: "B2B",
  hq_city: "Bangalore",
  investors_lead: ["Accel Partners India"],
  investors_participating: ["Accel", "Some Angel Fund", "existing investors"],
  investors_existing: ["Blume"],
  founders: [{ name: " Asha Rao ", previous_company: "Razorpay" }],
  founded_year: 2022,
  valuation: nullMoney,
  prior_round_stage: "Seed",
  prior_round_date: "2024-03",
  total_raised_to_date: nullMoney,
  extraction_confidence: 0.9,
  ...over,
});
const ctx = { announcedDate: "2026-10-08", fx: { usdInr: 96, date: "2026-10-08" }, today: "2026-10-11" };

describe("buildDealCandidate", () => {
  it("normalises every field deterministically", () => {
    const r = buildDealCandidate(deal(), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.value;
    expect(c.normalizedName).toBe("acme");
    expect(c.roundStage).toBe("Pre-Series A");
    expect(c.amount?.amountInr).toBe(400_000_000);
    expect(c.amount?.amountUsd).toBe(Math.round(400_000_000 / 96));
    expect(c.isoWeek).toBe("2026-W41");
    expect(c.hqCity).toBe("Bengaluru");
    expect(c.domain).toBe("acme.in");
    expect(c.sectorSecondary).toEqual(["B2B SaaS"]);
    expect(c.priorRoundDate).toBe("2024-03-01");
    expect(c.founders[0]).toEqual({ name: "Asha Rao", previousCompany: "Razorpay" });
  });

  it("canonicalises investors, lead wins, drops non-entities and duplicates across roles", () => {
    const r = buildDealCandidate(deal(), ctx);
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.investors.lead).toEqual(["Accel India"]);
    expect(r.value.investors.participating).toEqual(["Some Angel Fund"]);
    expect(r.value.investors.existing).toEqual(["Blume Ventures"]);
  });

  it("undisclosed amount is undisclosed, never estimated", () => {
    const r = buildDealCandidate(deal({ amount: nullMoney, amount_confidence: "reported" }), ctx);
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.amount).toBeNull();
    expect(r.value.amountConfidence).toBe("undisclosed");
  });

  it("rejects generic company names with a reason", () => {
    const r = buildDealCandidate(deal({ company_name: "The Startup" }), ctx);
    expect(r).toEqual({ ok: false, reason: 'unusable company name "The Startup"' });
  });

  it("null sector falls into the explicit Other bucket; unmapped stage → Undisclosed", () => {
    const r = buildDealCandidate(deal({ sector_primary: null, round_stage: null, stage_raw: "tranche" }), ctx);
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.sectorPrimary).toBe("Other");
    expect(r.value.roundStage).toBe("Undisclosed");
    expect(r.value.stageMapped).toBe(false);
  });
});

describe("normalizePartialDate", () => {
  it("expands partial dates and rejects future or malformed ones", () => {
    expect(normalizePartialDate("2024", "2026-10-11")).toBe("2024-01-01");
    expect(normalizePartialDate("2024-07-15", "2026-10-11")).toBe("2024-07-15");
    expect(normalizePartialDate("2027-01", "2026-10-11")).toBeNull();
    expect(normalizePartialDate("March 2024", "2026-10-11")).toBeNull();
  });
});

describe("buildEventCandidate", () => {
  const ev = (over: Partial<ExtractedEvent>): ExtractedEvent => ({
    event_type: "ma",
    summary: "Adobe acquired Rilo.",
    company_name: "Rilo",
    counterparty_name: "Adobe",
    amount: nullMoney,
    event_date: null,
    sector_primary: "B2B SaaS",
    hq_city: null,
    person_name: null,
    person_role: null,
    move_type: null,
    from_company: null,
    to_company: null,
    fund_name: null,
    fund_size: nullMoney,
    fund_vintage: null,
    stated_focus: [],
    extraction_confidence: 0.9,
    ...over,
  });
  const ectx = { eventDate: "2026-10-09", fx: { usdInr: 96, date: "2026-10-09" } };

  it("keys M&A on the target", () => {
    const r = buildEventCandidate(ev({}), ectx);
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.subjectKey).toBe("rilo");
  });
  it("keys fund closes on fund name and converts fund size", () => {
    const r = buildEventCandidate(
      ev({ event_type: "fund_close", company_name: "Blume", fund_name: "Blume Fund V", fund_size: { value: 2500, currency: "INR", unit: "crore", raw: "₹2,500 crore" } }),
      ectx,
    );
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.subjectKey).toBe("blume fund v");
    expect(r.value.fundSizeUsd).toBe(Math.round(25_000_000_000 / 96));
  });
  it("keys people moves on person@company and rejects subjectless events", () => {
    const r = buildEventCandidate(ev({ event_type: "people_move", company_name: null, person_name: "Asha Rao", to_company: "Accel" }), ectx);
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.subjectKey).toBe("asha rao@accel");
    expect(buildEventCandidate(ev({ company_name: null }), ectx).ok).toBe(false);
  });
});
