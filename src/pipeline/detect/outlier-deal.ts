import { confidenceFor } from "@/config/detectors";
import { fired, gate, historyGate, quiet, r1, r2, usd, type Detector, type Finding } from "./types";

/** #11 — a deal >2σ from its stage × sector distribution (log10), else stage-only; n ≥ 8 required. */
export const outlierDeal: Detector = (ctx) => {
  const key = "outlier_deal";
  const g = gate(key);
  const blocked = historyGate(key, ctx);
  if (blocked) return blocked;
  const nMin = g.nMin ?? 8;
  const findings: Finding[] = [];
  let evaluated = 0;
  let maxZ = 0;
  for (const o of ctx.input.outliers) {
    const useBucket = o.b_n >= nMin && (o.b_sd ?? 0) > 0;
    const useStage = !useBucket && o.s_n >= nMin && (o.s_sd ?? 0) > 0;
    if (!useBucket && !useStage) continue;
    evaluated++;
    const m = (useBucket ? o.b_mean : o.s_mean) ?? 0;
    const sd = (useBucket ? o.b_sd : o.s_sd) ?? 1;
    const z = (Math.log10(o.amount) - m) / sd;
    if (Math.abs(z) > Math.abs(maxZ)) maxZ = z;
    if (Math.abs(z) < (g.eMin ?? 2)) continue;
    const label = ctx.input.labels.get(o.deal_id);
    const bucket = useBucket ? `${o.stage} × ${o.sector}` : `${o.stage} (all sectors)`;
    findings.push({
      subject: o.deal_id,
      title: `${label?.company ?? "A deal"}: unusually ${z > 0 ? "large" : "small"} ${o.stage} round`,
      statement: `${label?.company ?? "This deal"} raised ${usd(o.amount)}, ${r1(Math.abs(z))}σ ${z > 0 ? "above" : "below"} the typical ${bucket} round (n=${useBucket ? o.b_n : o.s_n}, log scale).`,
      confidence: confidenceFor(z, g.eMin),
      sampleSize: useBucket ? o.b_n : o.s_n,
      effectSize: r2(z),
      statBasis: { amount: o.amount, bucket, n: useBucket ? o.b_n : o.s_n, log10_mean: m, log10_sd: sd, typical_round: 10 ** m },
      evidenceDealIds: [o.deal_id],
      evidenceEventIds: [],
    });
  }
  if (findings.length) return fired(key, ctx, findings, evaluated, r2(maxZ));
  if (evaluated === 0) {
    return { key, status: "suppressed", reason: `No priced deal this week had a bucket with n ≥ ${nMin} (stage × sector or stage-only).`, observed: { n: 0, effect: null, baselineWeeks: ctx.baselineWeeks.length }, findings: [] };
  }
  return quiet(key, ctx, `${evaluated} deals checked; none beyond ${g.eMin}σ (max ${r1(maxZ)}σ).`, evaluated, r2(maxZ));
};
