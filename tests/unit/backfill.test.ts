import { describe, expect, it } from "vitest";
import { weekFromSlug } from "@/pipeline/backfill";
import { loadPrompt, renderPrompt } from "@/lib/gemini";

describe("weekFromSlug", () => {
  const today = "2026-10-11";
  it("parses Entrackr week ranges and infers the year", () => {
    expect(weekFromSlug("/report/x/funding-and-acquisitions-in-indian-startups-this-week-oct-5-oct-10-12662210", today)).toEqual({ start: "2026-10-05", end: "2026-10-10" });
    expect(weekFromSlug("/report/x/this-week-july-27-aug-01-12217797", today)).toEqual({ start: "2026-07-27", end: "2026-08-01" });
    expect(weekFromSlug("/report/x/this-week-sept-28-oct-3-12618694", today)).toEqual({ start: "2026-09-28", end: "2026-10-03" });
  });
  it("never puts a week in the future: a later month means last year", () => {
    expect(weekFromSlug("/report/x/this-week-nov-10-nov-15-11000000", today)).toEqual({ start: "2025-11-10", end: "2025-11-15" });
  });
  it("handles weeks that cross a year boundary", () => {
    expect(weekFromSlug("/report/x/this-week-dec-29-jan-3-11500000", "2026-02-01")).toEqual({ start: "2025-12-29", end: "2026-01-03" });
  });
  it("rejects slugs without a recognisable range", () => {
    expect(weekFromSlug("/report/x/monthly-funding-report-12345678", today)).toBeNull();
    expect(weekFromSlug("/report/x/this-week-foo-1-bar-2-12345678", today)).toBeNull();
  });
});

describe("extract-roundup.v1", () => {
  it("carries the null rule and renders with its variables", () => {
    const tpl = loadPrompt({ name: "extract-roundup", version: 1 });
    expect(tpl).toContain("Return null if the article does not state this. Do not infer, estimate, or guess.");
    const vars = [...tpl.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]);
    expect(new Set(vars)).toEqual(new Set(["week", "publication", "stages", "sectors", "article"]));
    expect(() => renderPrompt(tpl, { week: "w", publication: "p", stages: "s", sectors: "x", article: "a" })).not.toThrow();
  });
});
