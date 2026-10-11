import { addWeeks } from "@/db/queries/detection";
import { confidenceFor } from "@/config/detectors";
import { fired, gate, historyGate, median, quiet, r1, type Detector } from "./types";

/** #7 — median months between rounds, recent 4 weeks vs earlier. Suppressed below 4 pairs. */
export const followonCompression: Detector = (ctx) => {
  const key = "followon_compression";
  const g = gate(key);
  const blocked = historyGate(key, ctx);
  if (blocked) return blocked;
  const recentFrom = addWeeks(ctx.input.targetWeek, -3);
  const recent = ctx.input.roundPairs.filter((p) => p.later_week >= recentFrom && p.later_week <= ctx.input.targetWeek);
  const earlier = ctx.input.roundPairs.filter((p) => p.later_week < recentFrom);
  if (recent.length < (g.nMin ?? 4) || earlier.length < (g.nMin ?? 4)) {
    return {
      key,
      status: "suppressed",
      reason: `Only ${recent.length} recent and ${earlier.length} earlier round pairs; needs ${g.nMin} of each.`,
      observed: { n: recent.length, effect: null, baselineWeeks: ctx.baselineWeeks.length },
      findings: [],
    };
  }
  const mRecent = median(recent.map((p) => p.gap_months)) ?? 0;
  const mEarlier = median(earlier.map((p) => p.gap_months)) ?? 0;
  const shorter = mEarlier > 0 ? ((mEarlier - mRecent) / mEarlier) * 100 : 0;
  if (shorter < (g.eMin ?? 20)) return quiet(key, ctx, `Median gap ${r1(mRecent)} months recently vs ${r1(mEarlier)} earlier (${r1(shorter)}% shorter; needs ${g.eMin}%).`, recent.length, r1(shorter));
  return fired(key, ctx, [{
    subject: "",
    title: "Follow-on rounds arriving faster",
    statement: `Companies raised their next round after a median ${r1(mRecent)} months in the last 4 weeks (n=${recent.length}) vs ${r1(mEarlier)} months earlier (n=${earlier.length}), ${r1(shorter)}% faster.`,
    confidence: confidenceFor(shorter, g.eMin),
    sampleSize: recent.length,
    effectSize: r1(shorter),
    statBasis: { median_recent: mRecent, n_recent: recent.length, median_earlier: mEarlier, n_earlier: earlier.length },
    evidenceDealIds: recent.map((p) => p.deal_id),
    evidenceEventIds: [],
  }], recent.length, r1(shorter));
};
