import { confidenceFor, MIN_BASELINE_CITY_DEALS } from "@/config/detectors";
import { fired, gate, historyGate, pct, quiet, r1, type Detector, type Finding } from "./types";

/** #9 — a city's share of (city-reported) deals this week vs the trailing share. */
export const geographicShift: Detector = (ctx) => {
  const key = "geographic_shift";
  const g = gate(key);
  const blocked = historyGate(key, ctx);
  if (blocked) return blocked;
  const week = ctx.input.cityWeekly.filter((r) => r.week === ctx.input.targetWeek);
  const base = ctx.input.cityWeekly.filter((r) => ctx.baselineWeeks.includes(r.week));
  const totalNow = week.reduce((s, r) => s + r.n, 0);
  const totalBase = base.reduce((s, r) => s + r.n, 0);
  if (totalBase < MIN_BASELINE_CITY_DEALS) {
    return {
      key,
      status: "suppressed",
      reason: `Only ${totalBase} baseline deals report a city (needs ${MIN_BASELINE_CITY_DEALS}); weekly roundups rarely name cities.`,
      observed: { n: totalNow, effect: null, baselineWeeks: ctx.baselineWeeks.length },
      findings: [],
    };
  }
  const findings: Finding[] = [];
  let maxPp = 0;
  for (const city of new Set([...week, ...base].map((r) => r.city))) {
    const now = week.find((r) => r.city === city);
    const n = now?.n ?? 0;
    const shareNow = totalNow ? n / totalNow : 0;
    const shareBase = base.filter((r) => r.city === city).reduce((s, r) => s + r.n, 0) / totalBase;
    const pp = (shareNow - shareBase) * 100;
    if (Math.abs(pp) > Math.abs(maxPp)) maxPp = pp;
    if (n < (g.nMin ?? 4) || Math.abs(pp) < (g.eMin ?? 10)) continue;
    findings.push({
      subject: city,
      title: `${city} share of deals ${pp > 0 ? "up" : "down"}`,
      statement: `${city} hosted ${n} of ${totalNow} city-reported deals this week (${pct(shareNow)}) vs ${pct(shareBase)} over the prior ${ctx.baselineWeeks.length} weeks (${pp > 0 ? "+" : ""}${r1(pp)} pp).`,
      confidence: confidenceFor(pp, g.eMin),
      sampleSize: n,
      effectSize: r1(pp),
      statBasis: { n_now: n, total_now: totalNow, share_now: shareNow, share_baseline: shareBase, total_baseline: totalBase },
      evidenceDealIds: (now?.deal_ids ?? []).slice(0, 6),
      evidenceEventIds: [],
    });
  }
  return findings.length ? fired(key, ctx, findings, totalNow, r1(maxPp)) : quiet(key, ctx, `No city with ≥${g.nMin} deals moved ≥${g.eMin} pp.`, totalNow, r1(maxPp));
};
