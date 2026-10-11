import "dotenv/config";
import { getSql } from "@/db/client";

/**
 * M2 acceptance aid: prints N random deals next to the source text they were
 * extracted from, so company, amount and stage can be checked by eye.
 * Usage: npm run spot-check -- 10
 */
async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? "10");
  const sql = getSql();
  const rows = await sql`
    SELECT d.id, c.canonical_name, d.round_stage, d.amount_usd, d.amount_raw, d.amount_confidence,
           d.announced_date::text AS announced, d.sector_primary, d.hq_city, d.corroboration_count,
           ds.publication, ds.url, ds.headline,
           left(ra.body_text, 700) AS body
    FROM deals d
    JOIN companies c ON c.id = d.company_id
    JOIN deal_sources ds ON ds.deal_id = d.id AND ds.is_primary
    JOIN raw_articles ra ON ra.id = ds.raw_article_id
    ORDER BY random()
    LIMIT ${n}`;
  for (const [i, r] of rows.entries()) {
    const leads = await sql`
      SELECT i.canonical_name FROM deal_investors di JOIN investors i ON i.id = di.investor_id
      WHERE di.deal_id = ${r.id} AND di.role = 'lead'`;
    const usd = r.amount_usd === null ? "undisclosed" : `$${(Number(r.amount_usd) / 1e6).toFixed(2)}M`;
    console.log(`\n#${i + 1} ${r.canonical_name} | ${r.round_stage} | ${usd} (${r.amount_raw ?? "-"}, ${r.amount_confidence}) | ${r.sector_primary} | ${r.hq_city ?? "-"} | ${r.announced} | sources=${r.corroboration_count}`);
    console.log(`   lead: ${leads.map((l) => l.canonical_name).join(", ") || "-"}`);
    console.log(`   ${r.publication}: ${r.headline}`);
    console.log(`   ${r.url}`);
    console.log(`   TEXT: ${String(r.body ?? "").replace(/\s+/g, " ").slice(0, 600)}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
