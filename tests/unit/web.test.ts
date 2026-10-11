import { describe, expect, it } from "vitest";
import { bucketOf, histogram } from "@/db/queries/dashboard";
import { layoutGraph, shortestPath, topNetwork, type CoInvestGraph } from "@/db/queries/investors";
import { pressureScore } from "@/db/queries/portfolio";
import { dealFiltersSchema, filtersToParams, nlFilterSchema, nlToFilters, parseDealFilters } from "@/lib/deal-filters";
import { csvCell, delta, parseCsv, toCsv, usd } from "@/lib/format";
import { keywordProblems, portfolioInputSchema, WATCHLIST_CSV_HEADER, watchItemFromCsv } from "@/lib/settings-schemas";
import { resolveWindow } from "@/lib/view";
import { chooseK, kmeans } from "@/pipeline/market-map";

describe("deal filters (whitelisted, validated)", () => {
  it("parses repeated and comma-separated params and drops unknown values", () => {
    const f = parseDealFilters(new URLSearchParams("sector=Fintech,Healthtech&sector=NotASector&stage=Seed&tier=act_now&tier=bogus&min_amount=2000000&verified=1&sort=score&drop=1"));
    expect(f.sector).toEqual(["Fintech", "Healthtech"]);
    expect(f.stage).toEqual(["Seed"]);
    expect(f.tier).toEqual(["act_now"]);
    expect(f.min_amount).toBe(2_000_000);
    expect(f.verified).toBe(true);
    expect(f.sort).toBe("score");
    expect(f).not.toHaveProperty("drop");
  });
  it("drops only the invalid field, keeping the rest", () => {
    const f = parseDealFilters({ from: "not-a-date", city: "Bengaluru", limit: "9999" });
    expect(f.from).toBeUndefined();
    expect(f.city).toBe("Bengaluru");
    expect(f.limit).toBe(50);
  });
  it("round-trips through the query string", () => {
    const f = dealFiltersSchema.parse({ sector: ["D2C & Commerce"], investor: "Peak XV", from: "2026-08-01", max_amount: 5e6, sort: "amount", cursor: 50 });
    expect(parseDealFilters(filtersToParams(f))).toEqual(f);
  });
});

describe("natural-language search output", () => {
  const nl = { sector: ["Fintech"], stage: ["Seed"], tier: null, investor: null, city: "Bengaluru", company: null, from: "2026-08-01", to: null, min_amount_usd: 2e6, max_amount_usd: null, verified_only: null, sort: "amount" as const, unsupported: ["good valuations"] };
  it("maps a valid Gemini filter object onto the same whitelisted filters", () => {
    const f = nlToFilters(nlFilterSchema.parse(nl), { profile: "aarav-familyoffice" });
    expect(f).toMatchObject({ sector: ["Fintech"], stage: ["Seed"], city: "Bengaluru", from: "2026-08-01", min_amount: 2e6, sort: "amount", profile: "aarav-familyoffice" });
  });
  it("rejects sectors outside the taxonomy and anything SQL-shaped", () => {
    expect(nlFilterSchema.safeParse({ ...nl, sector: ["Fintech'; DROP TABLE deals;--"] }).success).toBe(false);
    expect(nlFilterSchema.safeParse({ ...nl, from: "2026-08-01 OR 1=1" }).success).toBe(false);
  });
});

describe("CSV export/import", () => {
  it("quotes, escapes and neutralises formula cells", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(["x", "y"])).toBe("x|y");
    expect(csvCell(null)).toBe("");
  });
  it("watchlist CSV round-trips through the importer", () => {
    const csv = toCsv([...WATCHLIST_CSV_HEADER], [
      ["company", "Zepto", ["Kiranakart"], "quick commerce, Mumbai", ["qc", "late"], true, "watching"],
      ["investor", "Peak XV Partners", ["Sequoia India"], "=risky note", [], false, "dormant"],
    ]);
    const rows = parseCsv(csv);
    const header = rows[0] ?? [];
    const items = rows.slice(1).map((r) => watchItemFromCsv(r, header).item);
    expect(items[0]).toMatchObject({ watch_type: "company", value: "Zepto", aliases: ["Kiranakart"], notes: "quick commerce, Mumbai", tags: ["qc", "late"], alerts_enabled: true });
    expect(items[1]).toMatchObject({ watch_type: "investor", notes: "=risky note", alerts_enabled: false, status: "dormant" });
  });
  it("reports invalid rows instead of importing them", () => {
    expect(watchItemFromCsv(["planet", "X"], ["watch_type", "value"]).error).toContain("watch_type");
  });
});

describe("portfolio keyword guidance (CLAUDE.md §7.6)", () => {
  it("flags sector names and generic terms, accepts specific phrases", () => {
    expect(keywordProblems(["fintech", "SaaS", "embedded finance", "BNPL for B2B"])).toHaveLength(2);
    const ok = portfolioInputSchema.safeParse({ profile: "aarav-familyoffice", name: "X", description: "B2B payments for kirana distributors in India", sector: "Fintech", adjacency_keywords: ["embedded finance", "BNPL for B2B", "distributor credit"] });
    expect(ok.success).toBe(true);
    const bad = portfolioInputSchema.safeParse({ profile: "aarav-familyoffice", name: "X", description: "B2B payments for kirana distributors in India", sector: "Fintech", adjacency_keywords: ["fintech", "payments app", "lending"] });
    expect(bad.success).toBe(false);
  });
});

describe("warm-path finder (BFS over co-investment)", () => {
  // 1 —d1— 2 —d2— 3 —d3— 4 ; 1 —d4— 5
  const g: CoInvestGraph = {
    names: new Map([[1, "Lead"], [2, "A"], [3, "B"], [4, "Watched"], [5, "C"]]),
    companies: new Map([["d1", "Co1"], ["d2", "Co2"], ["d3", "Co3"], ["d4", "Co4"]]),
    adj: new Map([
      [1, new Map([[2, ["d1"]], [5, ["d4"]]])],
      [2, new Map([[1, ["d1"]], [3, ["d2"]]])],
      [3, new Map([[2, ["d2"]], [4, ["d3"]]])],
      [4, new Map([[3, ["d3"]]])],
      [5, new Map([[1, ["d4"]]])],
    ]),
  };
  it("returns the shortest chain with the deals that connect each hop", () => {
    const p = shortestPath(g, [1], new Set([4]));
    expect(p?.map((h) => `${h.from.name}>${h.to.name}`)).toEqual(["Lead>A", "A>B", "B>Watched"]);
    expect(p?.[2]?.deals[0]?.company).toBe("Co3");
  });
  it("respects the hop limit and reports no path", () => {
    expect(shortestPath(g, [1], new Set([4]), 2)).toBeNull();
    expect(shortestPath(g, [5], new Set([99]))).toBeNull();
  });
  it("network view drops isolated nodes and lays out inside the canvas", () => {
    const net = topNetwork(g, 10, 1);
    expect(net.nodes).toHaveLength(5);
    expect(net.edges).toHaveLength(4);
    for (const p of layoutGraph(net.nodes, net.edges, 400).values()) {
      expect(p.x).toBeGreaterThanOrEqual(40);
      expect(p.x).toBeLessThanOrEqual(360);
    }
  });
});

describe("competitive pressure", () => {
  const now = new Date("2026-10-12T00:00:00Z");
  it("weights competitors over same-layer, decays with age and ignores other relationships", () => {
    const fresh = pressureScore([{ relationship: "competitor", announced: "2026-10-12", confidence: 1 }], now);
    const old = pressureScore([{ relationship: "competitor", announced: "2026-08-13", confidence: 1 }], now);
    const layer = pressureScore([{ relationship: "same_layer", announced: "2026-10-12", confidence: 1 }], now);
    const supplier = pressureScore([{ relationship: "supplier", announced: "2026-10-12", confidence: 1 }], now);
    expect(fresh.score).toBe(1);
    expect(old.score).toBeCloseTo(Math.exp(-2), 2);
    expect(layer.score).toBe(0.6);
    expect(supplier.score).toBe(0);
    expect(fresh.last30).toBe(1);
    expect(old.last30).toBe(0);
  });
});

describe("market map clustering (nightly, never on page load)", () => {
  it("chooses k between 2 and 6", () => {
    expect(chooseK(6)).toBe(2);
    expect(chooseK(60)).toBe(5);
    expect(chooseK(500)).toBe(6);
  });
  it("separates obvious groups and is deterministic for a seed", () => {
    const pts = [[0, 0], [0.1, 0], [0, 0.1], [10, 10], [10.1, 10], [10, 10.1]];
    const a = kmeans(pts, 2, 42);
    expect(new Set(a.assign.slice(0, 3)).size).toBe(1);
    expect(new Set(a.assign.slice(3)).size).toBe(1);
    expect(a.assign[0]).not.toBe(a.assign[3]);
    expect(kmeans(pts, 2, 42).assign).toEqual(a.assign);
  });
});

describe("dashboard helpers", () => {
  it("buckets deal sizes and finds the median bucket", () => {
    const h = histogram([3e5, 8e5, 1.5e6, 1.5e6, 2e8]);
    expect(h.find((b) => b.label === "$1–2M")?.n).toBe(2);
    expect(h.find((b) => b.label === "$100M+")?.n).toBe(1);
    expect(bucketOf(1.5e6)).toBe("$1–2M");
    expect(bucketOf(null)).toBeNull();
  });
  it("formats money and changes", () => {
    expect(usd(2_150_000)).toBe("$2.1M");
    expect(usd(null)).toBe("undisclosed");
    expect(delta(12, 10)).toEqual({ text: "▲ 20%", dir: "up" });
    expect(delta(3, 0).text).toBe("▲ new");
    expect(delta(2, 5, "abs")).toEqual({ text: "▼ 3", dir: "down" });
  });
  it("window defaults to the digest window (last_digest_sent_at → now)", () => {
    const now = new Date("2026-10-12T06:00:00Z");
    const p = { id: "x", displayName: "x", config: {} as never, lastDigestSentAt: new Date("2026-10-05T01:00:00Z") };
    expect(resolveWindow(null, p, now)).toMatchObject({ key: "digest", start: "2026-10-05", end: "2026-10-12", days: 8 });
    expect(resolveWindow("30d", p, now)).toMatchObject({ start: "2026-09-13", days: 30 });
  });
});
