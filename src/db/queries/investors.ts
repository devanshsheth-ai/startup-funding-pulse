import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { normalizeCompanyName, normalizeInvestorKey } from "@/pipeline/normalize";

/**
 * Investor intelligence (PRD §18.3): leaderboard, investor profiles,
 * new-entrant log, co-investment graph and the warm-path finder. Counts come
 * from SQL; the graph search is plain BFS over deals already in the database.
 */

const num = z.coerce.number();
const numN = z.coerce.number().nullable();

export interface LeaderRow {
  id: number;
  name: string;
  deals: number;
  leadDeals: number;
  capitalLed: number;
  sectors: string[];
  firstDeal: string | null;
}

export async function getLeaderboard(start: string, end: string, limit = 25): Promise<LeaderRow[]> {
  const res = await getDb().execute(sql`
    SELECT i.id, i.canonical_name AS name, count(DISTINCT d.id) AS deals,
           count(DISTINCT d.id) FILTER (WHERE di.role = 'lead') AS lead_deals,
           coalesce(sum(d.amount_usd) FILTER (WHERE di.role = 'lead'), 0) AS capital_led,
           array_agg(DISTINCT d.sector_primary) AS sectors,
           (SELECT min(x.announced_date)::text FROM deal_investors y JOIN deals x ON x.id = y.deal_id WHERE y.investor_id = i.id) AS first_deal
    FROM deal_investors di JOIN deals d ON d.id = di.deal_id JOIN investors i ON i.id = di.investor_id
    WHERE d.announced_date BETWEEN ${start}::date AND ${end}::date
    GROUP BY i.id, i.canonical_name
    ORDER BY deals DESC, lead_deals DESC, capital_led DESC, name
    LIMIT ${limit}`);
  return z
    .array(z.object({ id: num, name: z.string(), deals: num, lead_deals: num, capital_led: num, sectors: z.array(z.string()), first_deal: z.string().nullable() }))
    .parse(res.rows)
    .map((r) => ({ id: r.id, name: r.name, deals: r.deals, leadDeals: r.lead_deals, capitalLed: r.capital_led, sectors: r.sectors, firstDeal: r.first_deal }));
}

/** Investors whose first deal in our data falls inside the window, with history before it. */
export async function getNewEntrants(since: string, limit = 30): Promise<{ id: number; name: string; firstDeal: string; deals: number; sectors: string[]; historyStart: string | null }[]> {
  const res = await getDb().execute(sql`
    WITH f AS (SELECT di.investor_id, min(d.announced_date) AS first_deal, count(DISTINCT d.id) AS deals, array_agg(DISTINCT d.sector_primary) AS sectors
               FROM deal_investors di JOIN deals d ON d.id = di.deal_id GROUP BY 1)
    SELECT i.id, i.canonical_name AS name, f.first_deal::text, f.deals, f.sectors, (SELECT min(announced_date)::text FROM deals) AS history_start
    FROM f JOIN investors i ON i.id = f.investor_id
    WHERE f.first_deal >= ${since}::date
    ORDER BY f.first_deal DESC, f.deals DESC LIMIT ${limit}`);
  return z
    .array(z.object({ id: num, name: z.string(), first_deal: z.string(), deals: num, sectors: z.array(z.string()), history_start: z.string().nullable() }))
    .parse(res.rows)
    .map((r) => ({ id: r.id, name: r.name, firstDeal: r.first_deal, deals: r.deals, sectors: r.sectors, historyStart: r.history_start }));
}

export interface InvestorProfile {
  id: number;
  name: string;
  aliases: string[];
  type: string | null;
  firstDeal: string | null;
  totals: { deals: number; leadDeals: number; priced: number; medianCheque: number | null; capitalLed: number };
  sectors: { sector: string; n: number }[];
  stages: { stage: string; n: number }[];
  cadence: { week: string; n: number }[];
  coInvestors: { id: number; name: string; together: number }[];
  dealIds: string[];
}

export async function getInvestorProfile(id: number): Promise<InvestorProfile | null> {
  const db = getDb();
  const head = await db.execute(sql`SELECT id, canonical_name AS name, coalesce(aliases, '{}') AS aliases, investor_type AS type FROM investors WHERE id = ${id}`);
  const h = z.array(z.object({ id: num, name: z.string(), aliases: z.array(z.string()), type: z.string().nullable() })).parse(head.rows)[0];
  if (!h) return null;
  const [tot, sec, stg, cad, co, ids] = await Promise.all([
    db.execute(sql`SELECT count(DISTINCT d.id) AS deals, count(DISTINCT d.id) FILTER (WHERE di.role = 'lead') AS lead_deals,
                          count(DISTINCT d.id) FILTER (WHERE d.amount_usd IS NOT NULL) AS priced,
                          percentile_cont(0.5) WITHIN GROUP (ORDER BY d.amount_usd) AS median,
                          coalesce(sum(d.amount_usd) FILTER (WHERE di.role = 'lead'), 0) AS capital_led, min(d.announced_date)::text AS first_deal
                   FROM deal_investors di JOIN deals d ON d.id = di.deal_id WHERE di.investor_id = ${id}`),
    db.execute(sql`SELECT d.sector_primary AS sector, count(DISTINCT d.id) AS n FROM deal_investors di JOIN deals d ON d.id = di.deal_id
                   WHERE di.investor_id = ${id} GROUP BY 1 ORDER BY 2 DESC`),
    db.execute(sql`SELECT d.round_stage AS stage, count(DISTINCT d.id) AS n FROM deal_investors di JOIN deals d ON d.id = di.deal_id
                   WHERE di.investor_id = ${id} GROUP BY 1 ORDER BY 2 DESC`),
    db.execute(sql`SELECT d.iso_week AS week, count(DISTINCT d.id) AS n FROM deal_investors di JOIN deals d ON d.id = di.deal_id
                   WHERE di.investor_id = ${id} AND d.iso_week IS NOT NULL GROUP BY 1 ORDER BY 1`),
    db.execute(sql`SELECT i.id, i.canonical_name AS name, count(DISTINCT a.deal_id) AS together
                   FROM deal_investors a JOIN deal_investors b ON b.deal_id = a.deal_id AND b.investor_id <> a.investor_id
                   JOIN investors i ON i.id = b.investor_id WHERE a.investor_id = ${id}
                   GROUP BY 1, 2 ORDER BY 3 DESC, 2 LIMIT 12`),
    db.execute(sql`SELECT DISTINCT d.id, d.announced_date FROM deal_investors di JOIN deals d ON d.id = di.deal_id WHERE di.investor_id = ${id} ORDER BY d.announced_date DESC`),
  ]);
  const t = z.object({ deals: num, lead_deals: num, priced: num, median: numN, capital_led: num, first_deal: z.string().nullable() }).parse(tot.rows[0]);
  return {
    id: h.id,
    name: h.name,
    aliases: h.aliases,
    type: h.type,
    firstDeal: t.first_deal,
    totals: { deals: t.deals, leadDeals: t.lead_deals, priced: t.priced, medianCheque: t.median, capitalLed: t.capital_led },
    sectors: z.array(z.object({ sector: z.string(), n: num })).parse(sec.rows),
    stages: z.array(z.object({ stage: z.string(), n: num })).parse(stg.rows),
    cadence: z.array(z.object({ week: z.string(), n: num })).parse(cad.rows),
    coInvestors: z.array(z.object({ id: num, name: z.string(), together: num })).parse(co.rows),
    dealIds: z.array(z.object({ id: z.string() })).parse(ids.rows).map((r) => r.id),
  };
}

// ─── Co-investment graph ───────────────────────────────────────────────────

export interface CoInvestGraph {
  /** investor id → name */
  names: Map<number, string>;
  /** investor id → neighbour id → shared deal ids */
  adj: Map<number, Map<number, string[]>>;
  /** deal id → company name */
  companies: Map<string, string>;
}

export async function loadCoInvestGraph(): Promise<CoInvestGraph> {
  const res = await getDb().execute(sql`
    SELECT DISTINCT di.deal_id, di.investor_id, i.canonical_name AS name, co.canonical_name AS company
    FROM deal_investors di JOIN investors i ON i.id = di.investor_id JOIN deals d ON d.id = di.deal_id JOIN companies co ON co.id = d.company_id`);
  const rows = z.array(z.object({ deal_id: z.string(), investor_id: num, name: z.string(), company: z.string() })).parse(res.rows);
  const names = new Map<number, string>();
  const companies = new Map<string, string>();
  const byDeal = new Map<string, number[]>();
  for (const r of rows) {
    names.set(r.investor_id, r.name);
    companies.set(r.deal_id, r.company);
    byDeal.set(r.deal_id, [...new Set([...(byDeal.get(r.deal_id) ?? []), r.investor_id])]);
  }
  const adj = new Map<number, Map<number, string[]>>();
  for (const [deal, invs] of byDeal) {
    for (const a of invs)
      for (const b of invs) {
        if (a === b) continue;
        const m = adj.get(a) ?? new Map<number, string[]>();
        m.set(b, [...(m.get(b) ?? []), deal]);
        adj.set(a, m);
      }
  }
  return { names, adj, companies };
}

export interface PathHop {
  from: { id: number; name: string };
  to: { id: number; name: string };
  deals: { id: string; company: string }[];
}

/**
 * Shortest co-investment path from any of `starts` to any of `targets`
 * (unweighted BFS; ties broken by more shared deals). Pure function.
 */
export function shortestPath(g: CoInvestGraph, starts: number[], targets: Set<number>, maxHops = 4): PathHop[] | null {
  const prev = new Map<number, number | null>();
  const queue: { id: number; depth: number }[] = [];
  for (const s of starts) {
    if (!prev.has(s)) {
      prev.set(s, null);
      queue.push({ id: s, depth: 0 });
    }
  }
  let found: number | null = starts.find((s) => targets.has(s)) ?? null;
  while (queue.length && found === null) {
    const cur = queue.shift() as { id: number; depth: number };
    if (cur.depth >= maxHops) continue;
    const nbrs = [...(g.adj.get(cur.id) ?? new Map<number, string[]>()).entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
    for (const [n] of nbrs) {
      if (prev.has(n)) continue;
      prev.set(n, cur.id);
      if (targets.has(n)) {
        found = n;
        break;
      }
      queue.push({ id: n, depth: cur.depth + 1 });
    }
  }
  if (found === null) return null;
  const chain: number[] = [];
  for (let x: number | null = found; x !== null; x = prev.get(x) ?? null) chain.unshift(x);
  const hops: PathHop[] = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = chain[i] as number;
    const b = chain[i + 1] as number;
    const shared = g.adj.get(a)?.get(b) ?? [];
    hops.push({
      from: { id: a, name: g.names.get(a) ?? String(a) },
      to: { id: b, name: g.names.get(b) ?? String(b) },
      deals: shared.slice(0, 5).map((d) => ({ id: d, company: g.companies.get(d) ?? d })),
    });
  }
  return hops;
}

export interface WarmPathResult {
  target: { company: string; dealIds: string[] } | null;
  startInvestors: { id: number; name: string; role: string }[];
  watchedInvestors: { id: number; name: string }[];
  unmatchedWatchlist: string[];
  path: PathHop[] | null;
  /** The start investor itself is on the watchlist. */
  direct: { id: number; name: string } | null;
}

/** The profile's watchlist investors resolved to investor ids (by id, name or alias). */
export async function getWatchedInvestors(profileId: string): Promise<{ watched: { id: number; name: string }[]; unmatched: string[] }> {
  const db = getDb();
  const wl = await db.execute(sql`SELECT value, normalized_value, investor_id, coalesce(aliases, '{}') AS aliases FROM watchlist WHERE profile_id = ${profileId} AND watch_type = 'investor' AND status <> 'removed'`);
  const watch = z.array(z.object({ value: z.string(), normalized_value: z.string(), investor_id: numN, aliases: z.array(z.string()) })).parse(wl.rows);
  const invs = await db.execute(sql`SELECT id, canonical_name AS name, coalesce(aliases, '{}') AS aliases FROM investors`);
  const allInv = z.array(z.object({ id: num, name: z.string(), aliases: z.array(z.string()) })).parse(invs.rows);
  const keyToId = new Map<string, number>();
  for (const i of allInv) {
    keyToId.set(normalizeInvestorKey(i.name), i.id);
    for (const a of i.aliases) keyToId.set(normalizeInvestorKey(a), i.id);
  }
  const watched: { id: number; name: string }[] = [];
  const unmatched: string[] = [];
  for (const w of watch) {
    const id = w.investor_id ?? keyToId.get(w.normalized_value) ?? w.aliases.map((a) => keyToId.get(normalizeInvestorKey(a))).find((x) => x !== undefined);
    if (id !== undefined) watched.push({ id, name: allInv.find((i) => i.id === id)?.name ?? w.value });
    else unmatched.push(w.value);
  }
  return { watched, unmatched };
}

/**
 * Warm-path finder (PRD §18.3): from the target company's lead investor(s)
 * through the co-investment graph to any investor on the profile's watchlist.
 * Falls back to all investors on the target's rounds when no lead is named.
 */
export async function findWarmPath(profileId: string, targetQuery: string): Promise<WarmPathResult> {
  const db = getDb();
  const norm = normalizeCompanyName(targetQuery);
  const t = await db.execute(sql`
    SELECT co.canonical_name AS company, d.id AS deal_id
    FROM companies co JOIN deals d ON d.company_id = co.id
    WHERE co.normalized_name = ${norm} OR co.canonical_name ILIKE ${targetQuery}
       OR ${norm} = ANY (SELECT lower(a) FROM unnest(coalesce(co.aliases, '{}')) a)
    ORDER BY d.announced_date DESC`);
  let trows = z.array(z.object({ company: z.string(), deal_id: z.string() })).parse(t.rows);
  if (trows.length === 0) {
    const fuzzy = await db.execute(sql`
      SELECT co.canonical_name AS company, d.id AS deal_id FROM companies co JOIN deals d ON d.company_id = co.id
      WHERE co.canonical_name ILIKE ${`%${targetQuery}%`} ORDER BY similarity(co.normalized_name, ${norm}) DESC, d.announced_date DESC LIMIT 5`);
    const f = z.array(z.object({ company: z.string(), deal_id: z.string() })).parse(fuzzy.rows);
    const first = f[0]?.company;
    trows = f.filter((r) => r.company === first);
  }
  const { watched, unmatched } = await getWatchedInvestors(profileId);
  const base: WarmPathResult = { target: null, startInvestors: [], watchedInvestors: watched, unmatchedWatchlist: unmatched, path: null, direct: null };
  if (trows.length === 0) return base;
  const dealIds = [...new Set(trows.map((r) => r.deal_id))];
  const st = await db.execute(sql`SELECT DISTINCT di.investor_id AS id, i.canonical_name AS name, di.role FROM deal_investors di JOIN investors i ON i.id = di.investor_id
                                  WHERE di.deal_id IN (${sql.join(dealIds.map((d) => sql`${d}`), sql`, `)})`);
  const starts = z.array(z.object({ id: num, name: z.string(), role: z.string() })).parse(st.rows);
  const leads = starts.filter((s) => s.role === "lead");
  const from = leads.length ? leads : starts;
  const result: WarmPathResult = { ...base, target: { company: trows[0]?.company ?? targetQuery, dealIds }, startInvestors: from };
  if (from.length === 0 || watched.length === 0) return result;
  const targets = new Set(watched.map((w) => w.id));
  const direct = from.find((s) => targets.has(s.id));
  if (direct) return { ...result, direct: { id: direct.id, name: direct.name }, path: [] };
  const g = await loadCoInvestGraph();
  return { ...result, path: shortestPath(g, from.map((s) => s.id), targets) };
}

/**
 * Co-investment network for the graph view: the investors with the most
 * distinct co-investors, joined by every round they shared. Isolated nodes
 * are dropped.
 */
export function topNetwork(g: CoInvestGraph, maxNodes = 32, minShared = 1): { nodes: { id: number; name: string; degree: number }[]; edges: { a: number; b: number; w: number }[] } {
  const ranked = [...g.adj.entries()]
    .map(([id, m]) => ({ id, degree: [...m.values()].filter((d) => d.length >= minShared).length }))
    .filter((x) => x.degree > 0)
    .sort((x, y) => y.degree - x.degree || x.id - y.id)
    .slice(0, maxNodes);
  const keep = new Set(ranked.map((n) => n.id));
  const edges: { a: number; b: number; w: number }[] = [];
  for (const [a, m] of g.adj) for (const [b, deals] of m) if (a < b && keep.has(a) && keep.has(b) && deals.length >= minShared) edges.push({ a, b, w: deals.length });
  const linked = new Set(edges.flatMap((e) => [e.a, e.b]));
  const nodes = ranked.filter((n) => linked.has(n.id)).map((n) => ({ id: n.id, name: g.names.get(n.id) ?? String(n.id), degree: n.degree }));
  return { nodes, edges };
}

/** Deterministic force-directed layout (Fruchterman–Reingold) for the SVG graph. Pure. */
export function layoutGraph(nodes: { id: number }[], edges: { a: number; b: number; w: number }[], size = 600, iterations = 300): Map<number, { x: number; y: number }> {
  const pos = new Map<number, { x: number; y: number }>();
  const n = nodes.length;
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, n);
    pos.set(node.id, { x: size / 2 + (size / 3) * Math.cos(angle), y: size / 2 + (size / 3) * Math.sin(angle) });
  });
  const k = Math.sqrt((size * size) / Math.max(1, n)) * 0.6;
  let temp = size / 10;
  for (let it = 0; it < iterations; it++) {
    const disp = new Map(nodes.map((v) => [v.id, { x: 0, y: 0 }]));
    for (const v of nodes)
      for (const u of nodes) {
        if (u.id === v.id) continue;
        const pv = pos.get(v.id) as { x: number; y: number };
        const pu = pos.get(u.id) as { x: number; y: number };
        const dx = pv.x - pu.x;
        const dy = pv.y - pu.y;
        const d = Math.max(0.01, Math.hypot(dx, dy));
        const f = (k * k) / d;
        const dv = disp.get(v.id) as { x: number; y: number };
        dv.x += (dx / d) * f;
        dv.y += (dy / d) * f;
      }
    for (const e of edges) {
      const pa = pos.get(e.a);
      const pb = pos.get(e.b);
      if (!pa || !pb) continue;
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      const d = Math.max(0.01, Math.hypot(dx, dy));
      const f = ((d * d) / k) * Math.min(2, 0.5 + e.w / 4);
      const da = disp.get(e.a) as { x: number; y: number };
      const db = disp.get(e.b) as { x: number; y: number };
      da.x -= (dx / d) * f;
      da.y -= (dy / d) * f;
      db.x += (dx / d) * f;
      db.y += (dy / d) * f;
    }
    for (const v of nodes) {
      const p = pos.get(v.id) as { x: number; y: number };
      const dv = disp.get(v.id) as { x: number; y: number };
      // Gravity keeps disconnected components on the canvas instead of pinned to its edges.
      dv.x -= (p.x - size / 2) * 0.08 * (k / 10);
      dv.y -= (p.y - size / 2) * 0.08 * (k / 10);
      const d = Math.max(0.01, Math.hypot(dv.x, dv.y));
      p.x = Math.min(size - 40, Math.max(40, p.x + (dv.x / d) * Math.min(d, temp)));
      p.y = Math.min(size - 20, Math.max(20, p.y + (dv.y / d) * Math.min(d, temp)));
    }
    temp *= 0.985;
  }
  return pos;
}
