import { confidenceFor } from "@/config/detectors";
import { fired, gate, historyGate, quiet, r1, r2, type Detector, type Finding } from "./types";

/** #6 — an investor pair co-investing ≥3 times (including this week) with lift ≥ 2. */
export const syndicateFormation: Detector = (ctx) => {
  const key = "syndicate_formation";
  const g = gate(key);
  const blocked = historyGate(key, ctx);
  if (blocked) return blocked;
  const findings: Finding[] = [];
  let maxLift = 0;
  let candidates = 0;
  for (const p of ctx.input.coinvest) {
    if (!p.in_target || p.together < (g.nMin ?? 3)) continue;
    candidates++;
    const expected = (p.a_deals * p.b_deals) / Math.max(p.total, 1);
    const lift = p.together / Math.max(expected, 1e-9);
    maxLift = Math.max(maxLift, lift);
    if (lift < (g.eMin ?? 2)) continue;
    findings.push({
      subject: `${p.a} + ${p.b}`,
      title: `${p.a} and ${p.b} keep co-investing`,
      statement: `${p.a} and ${p.b} have now co-invested ${p.together} times (${r1(lift)}× the ${r2(expected)} expected from their deal counts), including this week.`,
      confidence: confidenceFor(lift, g.eMin),
      sampleSize: p.together,
      effectSize: r2(lift),
      statBasis: { together: p.together, a_deals: p.a_deals, b_deals: p.b_deals, total_deals: p.total, expected },
      evidenceDealIds: p.deal_ids,
      evidenceEventIds: [],
    });
  }
  return findings.length
    ? fired(key, ctx, findings, candidates, r2(maxLift))
    : quiet(key, ctx, candidates ? `${candidates} pair(s) with ≥${g.nMin} co-investments this week, none with lift ≥${g.eMin} (max ${r2(maxLift)}).` : `No pair reached ${g.nMin} co-investments including this week.`, candidates, r2(maxLift));
};
