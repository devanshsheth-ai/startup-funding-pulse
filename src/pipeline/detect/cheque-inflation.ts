import { confidenceFor } from "@/config/detectors";
import { fired, gate, historyGate, quiet, r1, usd, type Detector, type Finding } from "./types";

/** #3 — median cheque per stage this week vs the trailing median for that stage. */
export const chequeInflation: Detector = (ctx) => {
  const key = "cheque_inflation";
  const g = gate(key);
  const blocked = historyGate(key, ctx);
  if (blocked) return blocked;
  const findings: Finding[] = [];
  let evaluated = 0;
  let maxChange = 0;
  for (const s of ctx.input.stageMedians) {
    if (s.t_n < (g.nMin ?? 0) || s.b_n < (g.nMin ?? 0) || !s.t_median || !s.b_median) continue;
    evaluated++;
    const change = ((s.t_median - s.b_median) / s.b_median) * 100;
    if (Math.abs(change) > Math.abs(maxChange)) maxChange = change;
    if (Math.abs(change) < (g.eMin ?? 0)) continue;
    findings.push({
      subject: s.stage,
      title: `${s.stage} cheques ${change > 0 ? "inflating" : "deflating"}`,
      statement: `Median ${s.stage} round was ${usd(s.t_median)} this week (n=${s.t_n}) vs ${usd(s.b_median)} over the prior ${ctx.baselineWeeks.length} weeks (n=${s.b_n}), ${change > 0 ? "+" : ""}${r1(change)}%.`,
      confidence: confidenceFor(change, g.eMin),
      sampleSize: s.t_n,
      effectSize: r1(change),
      statBasis: { median_now: s.t_median, n_now: s.t_n, median_baseline: s.b_median, n_baseline: s.b_n },
      evidenceDealIds: (s.t_ids ?? []).slice(0, 5),
      evidenceEventIds: [],
    });
  }
  if (findings.length) return fired(key, ctx, findings, evaluated, r1(maxChange));
  return quiet(key, ctx, evaluated ? `No stage's median moved ≥${g.eMin}% (largest ${r1(maxChange)}%).` : `No stage had ≥${g.nMin} priced deals both this week and in the baseline.`, evaluated, r1(maxChange));
};
