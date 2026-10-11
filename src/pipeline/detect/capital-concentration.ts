import { confidenceFor } from "@/config/detectors";
import { fired, gate, historyGate, mean, pct, quiet, r1, usd, type Detector } from "./types";

/** #8 — top-3 deals' share of the week's priced capital vs the trailing mean share. */
export const capitalConcentration: Detector = (ctx) => {
  const key = "capital_concentration";
  const g = gate(key);
  const blocked = historyGate(key, ctx);
  if (blocked) return blocked;
  const rows = ctx.input.concentration;
  const now = rows.find((r) => r.week === ctx.input.targetWeek);
  if (!now || now.priced < 3 || now.capital <= 0) return quiet(key, ctx, "Fewer than 3 priced deals this week.", now?.priced ?? 0, null);
  const shareNow = now.top3 / now.capital;
  const base = ctx.baselineWeeks.map((w) => rows.find((r) => r.week === w)).filter((r) => !!r && r.capital > 0 && r.priced >= 3);
  const shareBase = mean(base.map((r) => (r?.top3 ?? 0) / (r?.capital ?? 1)));
  const pp = (shareNow - shareBase) * 100;
  if (Math.abs(pp) < (g.eMin ?? 15)) return quiet(key, ctx, `Top-3 share ${pct(shareNow)} vs ${pct(shareBase)} baseline (${r1(pp)} pp; needs ±${g.eMin}).`, now.priced, r1(pp));
  return fired(key, ctx, [{
    subject: pp > 0 ? "concentrating" : "broadening",
    title: pp > 0 ? "Capital concentrated in a few big rounds" : "Capital spread more broadly",
    statement: `The three largest rounds took ${pct(shareNow)} of this week's ${usd(now.capital)} priced capital vs a ${pct(shareBase)} average over the prior ${base.length} weeks (${pp > 0 ? "+" : ""}${r1(pp)} pp).`,
    confidence: confidenceFor(pp, g.eMin),
    sampleSize: now.priced,
    effectSize: r1(pp),
    statBasis: { top3_share_now: shareNow, top3_share_baseline: shareBase, capital_now: now.capital, priced_now: now.priced, baseline_weeks_used: base.length },
    evidenceDealIds: now.top3_ids,
    evidenceEventIds: [],
  }], now.priced, r1(pp));
};
