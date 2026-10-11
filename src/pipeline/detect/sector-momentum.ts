import { confidenceFor } from "@/config/detectors";
import { fired, gate, historyGate, mean, quiet, r1, r2, sampleSd, type Detector, type Finding } from "./types";

/** #1 — a sector's weekly deal count vs its trailing 8-week mean, in σ (both directions). */
export const sectorMomentum: Detector = (ctx) => {
  const key = "sector_momentum";
  const g = gate(key);
  const blocked = historyGate(key, ctx);
  if (blocked) return blocked;
  const { input, baselineWeeks } = ctx;
  const sectors = new Set(input.sectorWeekly.map((r) => r.sector));
  const findings: Finding[] = [];
  let best = { z: 0, sector: "", n: 0 };
  for (const sector of sectors) {
    const rows = input.sectorWeekly.filter((r) => r.sector === sector);
    const now = rows.find((r) => r.week === input.targetWeek);
    const x = now?.n ?? 0;
    const series = baselineWeeks.map((w) => rows.find((r) => r.week === w)?.n ?? 0);
    const m = mean(series);
    const sd = Math.max(sampleSd(series), 1); // σ floor (D-051)
    const z = (x - m) / sd;
    const capSeries = baselineWeeks.map((w) => rows.find((r) => r.week === w)?.capital ?? 0);
    const capZ = sampleSd(capSeries) > 0 ? ((now?.capital ?? 0) - mean(capSeries)) / sampleSd(capSeries) : null;
    if (Math.abs(z) > Math.abs(best.z)) best = { z, sector, n: x };
    const accelerating = x >= (g.nMin ?? 0) && z >= (g.eMin ?? 0);
    const cooling = m >= (g.nMin ?? 0) && z <= -(g.eMin ?? 0);
    if (!accelerating && !cooling) continue;
    const dir = accelerating ? "accelerating" : "cooling";
    const recent = input.lastDealBySector.get(sector);
    findings.push({
      subject: `${sector}:${dir}`,
      title: `${sector} ${dir}`,
      statement: `${sector} recorded ${x} deal${x === 1 ? "" : "s"} this week vs ${r1(m)}/week over the prior ${series.length} weeks (${z >= 0 ? "+" : ""}${r1(z)}σ).`,
      confidence: confidenceFor(z, g.eMin),
      sampleSize: accelerating ? x : Math.round(m * series.length),
      effectSize: r2(z),
      statBasis: { week_count: x, baseline_mean: r2(m), baseline_sd: r2(sampleSd(series)), sd_used: r2(sd), baseline_series: series, capital_this_week: now?.capital ?? 0, capital_z: capZ === null ? null : r2(capZ) },
      evidenceDealIds: accelerating ? (now?.deal_ids ?? []).slice(0, 6) : recent ? [recent.deal_id] : [],
      evidenceEventIds: [],
    });
  }
  return findings.length
    ? fired(key, ctx, findings, best.n, r2(best.z))
    : quiet(key, ctx, `No sector moved ≥${g.eMin}σ with ≥${g.nMin} deals (largest: ${best.sector || "none"} at ${r1(best.z)}σ).`, best.n, r2(best.z));
};
