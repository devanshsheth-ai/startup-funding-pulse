import "dotenv/config";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { logger } from "@/lib/logger";
import { relinkDealInvestors } from "@/pipeline/dedupe";
import { recomputeInvestorCounts } from "@/pipeline/enrich";
import { canonicalInvestorName, normalizeInvestorKey } from "@/pipeline/normalize";

/**
 * Merge duplicate investors (D-076). An investor row is a duplicate when the
 * alias table maps its name to a different canonical name, or another row has
 * the same normalised name. Every deal linked to a duplicate has its investor
 * links rebuilt from its extractions (the same code dedupe uses), which now
 * resolves to the canonical investor. Duplicate rows are kept (deal_count 0)
 * and their names recorded as aliases on the survivor; nothing is deleted.
 * `--dry` lists what would change.
 */
async function main(): Promise<void> {
  const db = getDb();
  const dry = process.argv.includes("--dry");
  const rows = z
    .array(z.object({ id: z.coerce.number(), name: z.string(), deals: z.coerce.number() }))
    .parse((await db.execute(sql`SELECT i.id, i.canonical_name AS name, count(DISTINCT di.deal_id) AS deals FROM investors i LEFT JOIN deal_investors di ON di.investor_id = i.id GROUP BY 1, 2`)).rows);
  // Group by the normalised key of each row's canonical (alias-resolved) name.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = normalizeInvestorKey(canonicalInvestorName(r.name) ?? r.name);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const plans: { survivor: string; merged: string[]; deals: number }[] = [];
  const aliasesFor = new Map<string, string[]>();
  const dealIds = new Set<string>();
  for (const [, g] of groups) {
    if (g.length < 2 || g.filter((r) => r.deals > 0).length < 2) continue;
    const target = canonicalInvestorName(g[0]!.name) ?? g[0]!.name;
    const survivor = g.find((r) => r.name === target) ?? [...g].sort((a, b) => b.deals - a.deals)[0]!;
    const others = g.filter((r) => r.id !== survivor.id && r.deals > 0);
    plans.push({ survivor: target, merged: others.map((o) => `${o.name} (${o.deals})`), deals: others.reduce((n, o) => n + o.deals, 0) });
    for (const o of others) {
      const ds = z.array(z.object({ deal_id: z.string() })).parse((await db.execute(sql`SELECT DISTINCT deal_id FROM deal_investors WHERE investor_id = ${o.id}`)).rows);
      for (const d of ds) dealIds.add(d.deal_id);
      aliasesFor.set(target, [...(aliasesFor.get(target) ?? []), o.name]);
    }
  }
  for (const p of plans) logger.info("merge plan", p);
  logger.info("investor merge", { groups: plans.length, deals_to_relink: dealIds.size, dry });
  if (dry) return;
  for (const id of dealIds) await relinkDealInvestors(id);
  // Record merged spellings on the canonical row (it exists now: relinking created it if needed).
  for (const [target, names] of aliasesFor) {
    await db.execute(sql`UPDATE investors SET aliases = (SELECT array_agg(DISTINCT a) FROM unnest(coalesce(aliases, '{}') || ${`{${names.map((n) => `"${n.replace(/"/g, "")}"`).join(",")}}`}::text[]) a), updated_at = now() WHERE canonical_name = ${target}`);
  }
  await recomputeInvestorCounts();
  const left = z.array(z.object({ n: z.coerce.number() })).parse((await db.execute(sql`SELECT count(*) AS n FROM (SELECT normalized_name FROM investors WHERE deal_count > 0 GROUP BY 1 HAVING count(*) > 1) x`)).rows)[0]?.n ?? 0;
  logger.info("investor merge done", { relinked: dealIds.size, remaining_duplicate_normalized_names: left });
}
main().catch((err: unknown) => {
  logger.error("investor merge failed", { error: err instanceof Error ? err : String(err) });
  process.exit(1);
});
