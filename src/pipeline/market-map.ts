import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { parsePgVector } from "@/db/queries/health";
import { marketMapClusters } from "@/db/schema";
import { GeminiOutputError, GeminiUnavailableError, geminiConfigured, generateStructured } from "@/lib/gemini";
import { runLogger } from "@/lib/logger";
import { startStage } from "@/lib/run-log";
import type { StageResult } from "@/pipeline/ingest/collect";
import { sha256 } from "@/pipeline/ingest/url";

/**
 * Nightly market maps (PRD §18.6, CLAUDE.md §7.9): k-means over company
 * embeddings per sector, then one Gemini call per sector names the clusters.
 * Never run on page load. Each run inserts a fresh set of rows; pages read the
 * latest computed_at per sector, so older maps are kept, not deleted.
 */

export const MIN_COMPANIES = 6;
const MAX_K = 6;

/** Deterministic PRNG (mulberry32) so a sector's map is stable run to run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist2 = (a: number[], b: number[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += ((a[i] ?? 0) - (b[i] ?? 0)) ** 2;
  return s;
};

export function chooseK(n: number): number {
  return Math.max(2, Math.min(MAX_K, Math.round(Math.sqrt(n / 2))));
}

/** k-means++ seeding + Lloyd iterations. Pure and deterministic for a given seed. */
export function kmeans(points: number[][], k: number, seed: number, iterations = 50): { assign: number[]; centroids: number[][] } {
  const rand = rng(seed);
  const n = points.length;
  if (n === 0) return { assign: [], centroids: [] };
  const kk = Math.min(k, n);
  const centroids: number[][] = [[...(points[Math.floor(rand() * n)] ?? [])]];
  while (centroids.length < kk) {
    const d = points.map((p) => Math.min(...centroids.map((c) => dist2(p, c))));
    const total = d.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    let idx = 0;
    for (; idx < n - 1; idx++) {
      r -= d[idx] ?? 0;
      if (r <= 0) break;
    }
    centroids.push([...(points[idx] ?? [])]);
  }
  let assign = new Array<number>(n).fill(0);
  for (let it = 0; it < iterations; it++) {
    const next = points.map((p) => {
      let best = 0;
      let bd = Infinity;
      centroids.forEach((c, j) => {
        const dd = dist2(p, c);
        if (dd < bd) {
          bd = dd;
          best = j;
        }
      });
      return best;
    });
    const changed = next.some((a, i) => a !== assign[i]);
    assign = next;
    for (let j = 0; j < centroids.length; j++) {
      const members = points.filter((_, i) => assign[i] === j);
      if (members.length === 0) continue; // keep the old centroid for an empty cluster
      const dim = members[0]?.length ?? 0;
      centroids[j] = Array.from({ length: dim }, (_, x) => members.reduce((s, m) => s + (m[x] ?? 0), 0) / members.length);
    }
    if (!changed && it > 0) break;
  }
  return { assign, centroids };
}

const labelSchema = z.object({ labels: z.array(z.object({ i: z.number().int(), label: z.string().min(2).max(60) })) });

export async function clusterSector(sector: string, counters?: Parameters<typeof generateStructured>[0]["counters"]): Promise<number> {
  const db = getDb();
  const res = await db.execute(sql`
    SELECT co.id, co.canonical_name AS name, co.description, co.sub_sector, co.embedding::text AS embedding,
           count(DISTINCT d.id) AS deals, coalesce(sum(d.amount_usd), 0) AS capital
    FROM companies co JOIN deals d ON d.company_id = co.id
    WHERE d.sector_primary = ${sector} AND co.embedding IS NOT NULL
    GROUP BY co.id ORDER BY co.id`);
  const rows = z
    .array(z.object({ id: z.coerce.number(), name: z.string(), description: z.string().nullable(), sub_sector: z.string().nullable(), embedding: z.string(), deals: z.coerce.number(), capital: z.coerce.number() }))
    .parse(res.rows);
  if (rows.length < MIN_COMPANIES) return 0;
  const points = rows.map((r) => parsePgVector(r.embedding));
  const k = chooseK(rows.length);
  const seed = parseInt(sha256(sector).slice(0, 8), 16);
  const { assign, centroids } = kmeans(points, k, seed);
  const clusters = centroids
    .map((c, j) => ({ j, centroid: c, members: rows.filter((_, i) => assign[i] === j) }))
    .filter((c) => c.members.length > 0);

  // Labels: one Gemini call per sector; the commonest sub-sector is the fallback.
  const fallback = (ms: typeof rows) => {
    const counts = new Map<string, number>();
    for (const m of ms) if (m.sub_sector) counts.set(m.sub_sector, (counts.get(m.sub_sector) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? `${sector} group`;
  };
  const labels = new Map<number, string>();
  if (geminiConfigured()) {
    try {
      const { data } = await generateStructured({
        task: "label",
        prompt: { name: "market-map-label", version: 1 },
        vars: {
          sector,
          clusters: clusters
            .map((c, i) => `Cluster ${i}:\n${c.members.slice(0, 12).map((m) => `- ${m.name}${m.sub_sector ? ` [${m.sub_sector}]` : ""}: ${(m.description ?? "").slice(0, 160)}`).join("\n")}`)
            .join("\n\n"),
        },
        schema: labelSchema,
        temperature: 0.2,
        counters,
      });
      for (const l of data.labels) labels.set(l.i, l.label.trim());
    } catch (err) {
      if (!(err instanceof GeminiUnavailableError || err instanceof GeminiOutputError)) throw err;
    }
  }

  const ids = rows.map((r) => r.id);
  const inv = await db.execute(sql`
    SELECT d.company_id, i.canonical_name AS name, count(*) AS n FROM deal_investors di JOIN deals d ON d.id = di.deal_id JOIN investors i ON i.id = di.investor_id
    WHERE d.company_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) AND d.sector_primary = ${sector} GROUP BY 1, 2`);
  const invRows = z.array(z.object({ company_id: z.coerce.number(), name: z.string(), n: z.coerce.number() })).parse(inv.rows);
  const computedAt = new Date();
  const values = clusters.map((c, i) => {
    const memberIds = new Set(c.members.map((m) => m.id));
    const tally = new Map<string, number>();
    for (const r of invRows) if (memberIds.has(r.company_id)) tally.set(r.name, (tally.get(r.name) ?? 0) + r.n);
    return {
      sector,
      clusterLabel: labels.get(i) ?? fallback(c.members),
      companyIds: c.members.map((m) => m.id),
      dealCount: c.members.reduce((s, m) => s + m.deals, 0),
      totalCapitalUsd: String(c.members.reduce((s, m) => s + m.capital, 0)),
      topInvestors: [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n),
      centroid: c.centroid.map((v) => Number(v.toFixed(6))),
      computedAt,
    };
  });
  await db.insert(marketMapClusters).values(values);
  return values.length;
}

/** Dispatcher stage: one sector per step; cursor = index into the sector list. */
export async function runMarketMaps(opts: { runId: string; cursor: string | null; deadline: number }): Promise<StageResult> {
  const log = runLogger(opts.runId, "mapclusters");
  const stage = await startStage(opts.runId, "mapclusters");
  const sectorsRes = await getDb().execute(sql`
    SELECT d.sector_primary AS sector FROM deals d JOIN companies co ON co.id = d.company_id
    WHERE co.embedding IS NOT NULL GROUP BY 1 HAVING count(DISTINCT co.id) >= ${MIN_COMPANIES} ORDER BY 1`);
  const sectors = z.array(z.object({ sector: z.string() })).parse(sectorsRes.rows).map((r) => r.sector);
  let i = Number(opts.cursor ?? 0);
  const done: Record<string, number> = {};
  try {
    while (i < sectors.length && Date.now() < opts.deadline) {
      const s = sectors[i] as string;
      done[s] = await clusterSector(s, stage.counters);
      i++;
    }
    stage.counters.itemsIn = sectors.length;
    stage.counters.itemsOut = Object.values(done).reduce((a, b) => a + b, 0);
    const complete = i >= sectors.length;
    await stage.finish(complete ? "ok" : "partial", { clusters: done, next: complete ? null : i });
    log.info("market maps chunk", { done, complete });
    return { processed: Object.keys(done).length, next_cursor: complete ? null : String(i) };
  } catch (err) {
    await stage.finish("error", { clusters: done }, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
