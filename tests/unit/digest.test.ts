import { describe, expect, it } from "vitest";
import aarav from "../../seed/profile-aarav.json";
import { mandateConfigSchema } from "@/config/profile";
import { enforceBullets, enforceNarrative, fitHeadline, ownershipViolation } from "@/pipeline/narrate";
import { isDue } from "@/pipeline/deliver";
import { windowFor, withUtm } from "@/pipeline/digest";

const cfg = mandateConfigSchema.parse(aarav.config); // weekly, Monday 06:30 Asia/Kolkata
const tracked = ["Khatabook", "Even Healthcare"];
const allowed = { deals: new Set(["d1", "d2"]), events: new Set(["e1"]) };
const item = (o: Partial<{ claim: string; evidence_deal_ids: string[]; evidence_event_ids: string[] }> = {}) => ({
  claim: "Healthtech saw 4 deals vs 1.8/week.",
  evidence_deal_ids: ["d1"],
  evidence_event_ids: [] as string[],
  confidence: "emerging" as const,
  stat_basis: "4 vs 1.8",
  ...o,
});

describe("evidence enforcement (a paragraph without evidence is rejected in code)", () => {
  it("keeps a paragraph with valid evidence", () => {
    expect(enforceNarrative([item()], allowed, tracked).kept).toHaveLength(1);
  });
  it("rejects a paragraph with no evidence IDs", () => {
    const r = enforceNarrative([item({ evidence_deal_ids: [] })], allowed, tracked);
    expect(r.kept).toHaveLength(0);
    expect(r.rejected[0]?.reason).toBe("no evidence IDs");
  });
  it("rejects a paragraph whose evidence IDs were invented", () => {
    const r = enforceNarrative([item({ evidence_deal_ids: ["made-up-1", "made-up-2"] })], allowed, tracked);
    expect(r.kept).toHaveLength(0);
    expect(r.rejected[0]?.reason).toContain("not in the input");
  });
  it("strips invented IDs but keeps the paragraph when a valid one remains", () => {
    const r = enforceNarrative([item({ evidence_deal_ids: ["d2", "fake"] , evidence_event_ids: ["e1", "nope"] })], allowed, tracked);
    expect(r.kept[0]?.evidenceDealIds).toEqual(["d2"]);
    expect(r.kept[0]?.evidenceEventIds).toEqual(["e1"]);
  });
  it("rejects ownership language about the simulated portfolio", () => {
    for (const claim of ["Our portfolio company Khatabook faces a new rival.", "We invested in Even Healthcare last year.", "The fund holds a stake in Khatabook.", "This competes with our holdings."]) {
      expect(enforceNarrative([item({ claim })], allowed, tracked).kept, claim).toHaveLength(0);
    }
    expect(ownershipViolation("Kinetic Age competes with tracked company Even Healthcare.", tracked)).toBeNull();
  });
  it("drops TL;DR/LP bullets without a statistic, and a bad headline falls back", () => {
    expect(enforceBullets(["Fintech is heating up.", "Fintech logged 3 deals (+1.5σ)."], tracked, true).kept).toEqual(["Fintech logged 3 deals (+1.5σ)."]);
    expect(fitHeadline("A big week for startups", "33 deals, $216M", tracked)).toBe("33 deals, $216M");
    expect(fitHeadline("x".repeat(95) + " 3", "fallback 1", tracked)).toBe("fallback 1");
    expect(fitHeadline("33 deals raised $216M this week", "f", tracked)).toBe("33 deals raised $216M this week");
  });
});

describe("digest window (CLAUDE.md §7.1)", () => {
  const now = new Date("2026-10-12T01:00:00Z");
  it("runs from last_digest_sent_at to now, never a fixed 7 days once a send exists", () => {
    expect(windowFor("weekly", new Date("2026-10-08T01:00:00Z"), now)).toEqual({ start: "2026-10-08", end: "2026-10-12" });
  });
  it("falls back to 7 days (weekly) or 1 day (daily) only before the first send", () => {
    expect(windowFor("weekly", null, now).start).toBe("2026-10-05");
    expect(windowFor("daily", null, now).start).toBe("2026-10-11");
  });
  it("consecutive Monday and Thursday sends do not overlap beyond the boundary day", () => {
    const mon = new Date("2026-10-12T01:00:00Z");
    const thu = new Date("2026-10-15T01:00:00Z");
    const w1 = windowFor("weekly", new Date("2026-10-08T01:00:00Z"), mon);
    const w2 = windowFor("weekly", mon, thu); // last_digest_sent_at advanced to Monday's send
    expect(w1.end).toBe(w2.start);
  });
});

describe("scheduling (isDue)", () => {
  it("is due on Monday after 06:30 IST, once", () => {
    const monday0700ist = new Date("2026-10-12T01:30:00Z");
    expect(isDue(cfg, null, monday0700ist)).toMatchObject({ due: true, mode: "weekly" });
    expect(isDue(cfg, new Date("2026-10-12T01:15:00Z"), monday0700ist)).toMatchObject({ due: false, reason: "already sent today" });
  });
  it("is not due before the send hour or on other days", () => {
    expect(isDue(cfg, null, new Date("2026-10-12T00:30:00Z")).due).toBe(false); // 06:00 IST
    expect(isDue(cfg, null, new Date("2026-10-13T03:00:00Z")).reason).toContain("not a delivery day");
  });
  it("daily mode ignores days", () => {
    const daily = { ...cfg, delivery: { ...cfg.delivery, mode: "daily" as const, days: [] } };
    expect(isDue(daily, null, new Date("2026-10-14T03:00:00Z"))).toMatchObject({ due: true, mode: "daily" });
  });
});

describe("UTM tagging", () => {
  it("tags outbound links and keeps existing params", () => {
    const u = new URL(withUtm("https://inc42.com/buzz/x/?id=3", "weekly"));
    expect(u.searchParams.get("utm_source")).toBe("dealscope");
    expect(u.searchParams.get("utm_campaign")).toBe("digest-weekly");
    expect(u.searchParams.get("id")).toBe("3");
  });
});
