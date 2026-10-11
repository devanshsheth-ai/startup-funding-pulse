import { normalizeCompanyName } from "@/pipeline/normalize";
import { fired, gate, historyGate, quiet, type Detector, type Finding } from "./types";

/** #12 (best effort) — founders of ≥2 of this week's startups share a former employer. */
export const repeatFounder: Detector = (ctx) => {
  const key = "repeat_founder";
  const g = gate(key);
  const blocked = historyGate(key, ctx);
  if (blocked) return blocked;
  const byCompany = new Map<string, { label: string; deals: Set<string>; founders: string[] }>();
  for (const f of ctx.input.founders) {
    const k = normalizeCompanyName(f.previous_company);
    if (!k) continue;
    const e = byCompany.get(k) ?? { label: f.previous_company, deals: new Set<string>(), founders: [] };
    e.deals.add(f.deal_id);
    e.founders.push(`${f.founder} (${f.company})`);
    byCompany.set(k, e);
  }
  const findings: Finding[] = [];
  for (const [k, e] of byCompany) {
    if (e.deals.size < (g.nMin ?? 2)) continue;
    findings.push({
      subject: k,
      title: `Ex-${e.label} founders raising`,
      statement: `${e.deals.size} startups funded this week have founders from ${e.label}: ${e.founders.join(", ")}.`,
      confidence: "weak_signal",
      sampleSize: e.deals.size,
      effectSize: null,
      statBasis: { former_employer: e.label, deals: e.deals.size },
      evidenceDealIds: [...e.deals],
      evidenceEventIds: [],
    });
  }
  return findings.length
    ? fired(key, ctx, findings, ctx.input.founders.length, null)
    : quiet(key, ctx, `Best effort: ${ctx.input.founders.length} founder background(s) reported this week, no shared former employer.`, ctx.input.founders.length, null);
};
