import { addWeeks } from "@/db/queries/detection";
import { fired, gate, historyGate, quiet, type Detector, type Finding } from "./types";

/** #10 — a mandate core sector with zero deals for ≥3 consecutive weeks (negative pattern). */
export const sectorSilence: Detector = (ctx) => {
  const key = "sector_silence";
  const g = gate(key);
  const blocked = historyGate(key, ctx);
  if (blocked) return blocked;
  const findings: Finding[] = [];
  let longest = 0;
  const maxLook = Math.min(ctx.historyWeeks + 1, ctx.baselineWeeks.length + 1);
  for (const core of ctx.config.sectors_core) {
    let streak = 0;
    for (let i = 0; i < maxLook; i++) {
      const wk = addWeeks(ctx.input.targetWeek, -i);
      const n = ctx.input.sectorWeekly.find((r) => r.week === wk && r.sector === core.name)?.n ?? 0;
      if (n > 0) break;
      streak++;
    }
    longest = Math.max(longest, streak);
    if (streak < (g.eMin ?? 3)) continue;
    const last = ctx.input.lastDealBySector.get(core.name);
    findings.push({
      subject: core.name,
      title: `${core.name} has gone quiet`,
      statement: `No ${core.name} deals for ${streak} consecutive weeks${last ? ` (last: ${last.week})` : ""}, a core sector in this mandate.`,
      confidence: streak >= 6 ? "strong" : streak >= 4 ? "emerging" : "weak_signal",
      sampleSize: streak,
      effectSize: streak,
      statBasis: { silent_weeks: streak, last_deal_week: last?.week ?? null },
      evidenceDealIds: last ? [last.deal_id] : [],
      evidenceEventIds: [],
    });
  }
  return findings.length ? fired(key, ctx, findings, ctx.config.sectors_core.length, longest) : quiet(key, ctx, `Every core sector had a deal within the last ${g.eMin} weeks.`, ctx.config.sectors_core.length, longest);
};
