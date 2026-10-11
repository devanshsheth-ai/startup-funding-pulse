import { fired, gate, historyGate, quiet, type Detector, type Finding } from "./types";

/**
 * #4 — an established investor's first observed deal in a sector. The PRD
 * §14.3 guard is four explicit conditions, each logged when it blocks.
 */
export const investorRotation: Detector = (ctx) => {
  const key = "investor_rotation";
  const g = gate(key);
  const blocked = historyGate(key, ctx);
  if (blocked) return { ...blocked, guardLog: [`guard 3 (database history ≥ ${g.bMin} weeks) failed: ${ctx.historyWeeks} weeks`] };
  const log: string[] = [];
  const cutoff = new Date(ctx.now.getTime() - g.bMin * 7 * 86_400_000);
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const c of ctx.input.investorFirsts) {
    const id = `${c.investor}|${c.sector}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (c.deal_count < (g.nMin ?? 3)) {
      log.push(`${c.investor} → ${c.sector}: guard 1 failed (deal_count ${c.deal_count} < ${g.nMin})`);
      continue;
    }
    if (c.prior_in_sector > 0) continue; // guard 2: not a first move (the common case; not logged)
    // guard 3 (history) passed above.
    if (!c.first_seen || c.first_seen > cutoff) {
      log.push(`${c.investor} → ${c.sector}: guard 4 failed (first seen ${c.first_seen?.toISOString().slice(0, 10) ?? "unknown"}, needs ≤ ${cutoff.toISOString().slice(0, 10)})`);
      continue;
    }
    const deals = ctx.input.investorFirsts.filter((x) => x.investor === c.investor && x.sector === c.sector).map((x) => x.deal_id);
    const label = ctx.input.labels.get(c.deal_id);
    findings.push({
      subject: `${c.investor} → ${c.sector}`,
      title: `${c.investor} enters ${c.sector}`,
      statement: `${c.investor} backed ${label?.company ?? "a company"}, its first ${c.sector} deal in ${ctx.historyWeeks} weeks of data, after ${c.deal_count} deals elsewhere.`,
      confidence: c.deal_count >= 6 ? "strong" : "emerging",
      sampleSize: c.deal_count,
      effectSize: null,
      statBasis: { investor: c.investor, sector: c.sector, investor_deal_count: c.deal_count, prior_deals_in_sector: 0, history_weeks: ctx.historyWeeks, first_seen: c.first_seen.toISOString().slice(0, 10) },
      evidenceDealIds: [...new Set(deals)],
      evidenceEventIds: [],
    });
  }
  const out = findings.length
    ? fired(key, ctx, findings, findings.length, null, `${findings.length} first move${findings.length === 1 ? "" : "s"} passed all four guards.`)
    : quiet(key, ctx, `No investor passed all four guards (${seen.size} investor-sector pairs checked).`, 0, null);
  return { ...out, guardLog: log.slice(0, 50) };
};
