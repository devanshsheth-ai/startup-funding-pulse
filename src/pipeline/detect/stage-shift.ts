import { confidenceFor } from "@/config/detectors";
import { fired, gate, historyGate, pct, quiet, r1, type Detector, type Finding } from "./types";

/** #2 — share of priced capital by stage this week vs the trailing baseline share. */
export const stageShift: Detector = (ctx) => {
  const key = "stage_shift";
  const g = gate(key);
  const blocked = historyGate(key, ctx);
  if (blocked) return blocked;
  const { input, baselineWeeks } = ctx;
  const week = input.stageWeekly.filter((r) => r.week === input.targetWeek);
  const base = input.stageWeekly.filter((r) => baselineWeeks.includes(r.week));
  const pricedNow = week.reduce((s, r) => s + r.priced, 0);
  if (pricedNow < (g.nMin ?? 0)) return quiet(key, ctx, `Only ${pricedNow} priced deals this week; needs ${g.nMin}.`, pricedNow, null);
  const capNow = week.reduce((s, r) => s + r.capital, 0);
  const capBase = base.reduce((s, r) => s + r.capital, 0);
  if (capNow <= 0 || capBase <= 0) return quiet(key, ctx, "No priced capital to compare.", pricedNow, null);
  const stages = new Set([...week, ...base].map((r) => r.stage));
  const findings: Finding[] = [];
  let maxPp = 0;
  for (const stage of stages) {
    if (stage === "Undisclosed") continue;
    const now = week.find((r) => r.stage === stage);
    const shareNow = (now?.capital ?? 0) / capNow;
    const shareBase = base.filter((r) => r.stage === stage).reduce((s, r) => s + r.capital, 0) / capBase;
    const pp = (shareNow - shareBase) * 100;
    if (Math.abs(pp) > Math.abs(maxPp)) maxPp = pp;
    if (Math.abs(pp) < (g.eMin ?? 0)) continue;
    findings.push({
      subject: stage,
      title: `${stage} share of capital ${pp > 0 ? "up" : "down"}`,
      statement: `${stage} took ${pct(shareNow)} of priced capital this week vs ${pct(shareBase)} over the prior ${baselineWeeks.length} weeks (${pp > 0 ? "+" : ""}${r1(pp)} pp).`,
      confidence: confidenceFor(pp, g.eMin),
      sampleSize: pricedNow,
      effectSize: r1(pp),
      statBasis: { share_now: shareNow, share_baseline: shareBase, capital_now: capNow, capital_baseline: capBase, priced_deals_now: pricedNow },
      evidenceDealIds: (now?.deal_ids ?? []).slice(0, 5),
      evidenceEventIds: [],
    });
  }
  return findings.length ? fired(key, ctx, findings, pricedNow, r1(maxPp)) : quiet(key, ctx, `No stage's capital share moved ≥${g.eMin} pp (largest ${r1(maxPp)} pp).`, pricedNow, r1(maxPp));
};
