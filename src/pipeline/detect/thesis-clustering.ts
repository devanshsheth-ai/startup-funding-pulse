import { CLUSTER_CORPUS_PERCENTILE } from "@/config/detectors";
import { fired, gate, historyGate, quiet, r2, type Detector, type Finding } from "./types";

/**
 * #5 — three or more of this week's deals forming one tight embedding cluster.
 * Cohesion (mean pairwise cosine) must clear max(0.75, corpus p99) (D-051).
 */
export const thesisClustering: Detector = (ctx) => {
  const key = "thesis_clustering";
  const g = gate(key);
  const blocked = historyGate(key, ctx);
  if (blocked) return blocked;
  const tau = Math.max(g.eMin ?? 0.75, ctx.input.corpusP99 ?? 0);
  const sim = new Map<string, number>();
  const nodes = new Set<string>();
  for (const p of ctx.input.clusterPairs) {
    sim.set(`${p.a}|${p.b}`, p.sim);
    nodes.add(p.a);
    nodes.add(p.b);
  }
  const s = (a: string, b: string) => sim.get(a < b ? `${a}|${b}` : `${b}|${a}`) ?? 0;
  // Connected components over edges ≥ τ, then a cohesion check on each.
  const parent = new Map([...nodes].map((n) => [n, n]));
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  for (const p of ctx.input.clusterPairs) if (p.sim >= tau) parent.set(find(p.a), find(p.b));
  const groups = new Map<string, string[]>();
  for (const n of nodes) groups.set(find(n), [...(groups.get(find(n)) ?? []), n]);
  const findings: Finding[] = [];
  let bestCohesion = 0;
  for (const members of groups.values()) {
    if (members.length < (g.nMin ?? 3)) continue;
    const pairs: number[] = [];
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) pairs.push(s(members[i] ?? "", members[j] ?? ""));
    const cohesion = pairs.reduce((a, b) => a + b, 0) / pairs.length;
    bestCohesion = Math.max(bestCohesion, cohesion);
    if (cohesion < tau) continue;
    const labels = members.map((m) => ctx.input.labels.get(m)).filter((l) => !!l);
    const sectors = [...new Set(labels.map((l) => l.sector))];
    findings.push({
      subject: [...members].sort().join(","),
      title: `${members.length} similar ${sectors.join("/")} companies raised this week`,
      statement: `${labels.map((l) => l.company).join(", ")} raised this week and form one tight cluster (mean pairwise similarity ${r2(cohesion)} vs corpus 99th percentile ${r2(ctx.input.corpusP99 ?? 0)}).`,
      confidence: cohesion >= tau + 0.03 ? "strong" : "emerging",
      sampleSize: members.length,
      effectSize: r2(cohesion),
      statBasis: { cohesion, threshold: tau, corpus_p99: ctx.input.corpusP99, corpus_pairs: ctx.input.corpusPairs, percentile: CLUSTER_CORPUS_PERCENTILE },
      evidenceDealIds: members,
      evidenceEventIds: [],
    });
  }
  if (findings.length) return fired(key, ctx, findings, findings.length, r2(bestCohesion));
  // Report the tightest triple so a quiet week is explained, not just "nothing".
  const list = [...nodes];
  let bestTriple = { c: 0, names: [] as string[] };
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      for (let k = j + 1; k < list.length; k++) {
        const [a, b, c] = [list[i] ?? "", list[j] ?? "", list[k] ?? ""];
        const coh = (s(a, b) + s(a, c) + s(b, c)) / 3;
        if (coh > bestTriple.c) bestTriple = { c: coh, names: [a, b, c].map((x) => ctx.input.labels.get(x)?.company ?? x) };
      }
  return quiet(
    key,
    ctx,
    `No group of ≥${g.nMin} deals reached cohesion ${r2(tau)} (corpus 99th percentile); tightest triple ${bestTriple.names.join(", ") || "none"} at ${r2(bestTriple.c)}.`,
    nodes.size,
    r2(bestTriple.c),
  );
};
