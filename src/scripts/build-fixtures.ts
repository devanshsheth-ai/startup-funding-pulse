import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getSql } from "@/db/client";
import { logger } from "@/lib/logger";

/**
 * Regenerate the test fixtures from the database (PRD §25). Only structured
 * facts are written (names, amounts, stages, source URLs) — never article
 * text, which stays in the database and is re-read by the golden runner.
 *
 *   tests/fixtures/pipeline-snapshot.json  integration test: every source report of 25 real deals
 *   tests/fixtures/golden-funding.json     golden file: 20 articles about deals that ≥ 2 publications
 *                                          report identically, with the agreed fields as expected values
 */

const sql = getSql();
const q = async <T>(text: string, params: unknown[] = []) => (await sql.query(text, params)) as T[];

async function main(): Promise<void> {
  const dir = join(process.cwd(), "tests", "fixtures");

  // Integration snapshot: the 15 most-reported deals plus 10 single-source deals.
  const picked = await q<{ id: string }>(`
    (SELECT d.id FROM deals d JOIN deal_sources s ON s.deal_id = d.id GROUP BY d.id HAVING count(*) >= 2 ORDER BY count(*) DESC, d.id LIMIT 15)
    UNION ALL
    (SELECT d.id FROM deals d JOIN deal_sources s ON s.deal_id = d.id GROUP BY d.id HAVING count(*) = 1 ORDER BY d.id LIMIT 10)`);
  const ids = picked.map((p) => p.id);
  const dealRows = await q<Record<string, unknown>>(
    `SELECT d.id, c.canonical_name AS company, d.round_stage, d.amount_usd::float8 AS amount_usd, d.amount_confidence, d.corroboration_count,
            d.is_verified, d.has_disputed_field, coalesce(d.disputed_fields, '{}') AS disputed_fields, d.iso_week
     FROM deals d JOIN companies c ON c.id = d.company_id WHERE d.id = ANY($1) ORDER BY d.id`,
    [ids],
  );
  const sources = await q<Record<string, unknown>>(
    `SELECT s.deal_id, s.raw_article_id, s.publication, s.published_at, s.reported_stage, s.reported_amount_usd::float8 AS reported_amount_usd,
            s.reported_amount_raw, s.reported_amount_confidence, coalesce(s.reported_investors_lead, '{}') AS reported_investors_lead,
            er.payload
     FROM deal_sources s LEFT JOIN extracted_records er ON er.id = s.extracted_record_id
     WHERE s.deal_id = ANY($1) ORDER BY s.deal_id, s.raw_article_id`,
    [ids],
  );
  const snapshot = dealRows.map((d) => ({
    deal: d,
    sources: sources
      .filter((s) => s.deal_id === d.id)
      .map((s) => ({
        publication: s.publication,
        publishedAt: s.published_at,
        stage: s.reported_stage,
        amountUsd: s.reported_amount_usd,
        amountRaw: s.reported_amount_raw,
        amountConfidence: s.reported_amount_confidence,
        investorsLead: s.reported_investors_lead,
        // The validated extraction (structured fields only; description is Gemini's one-line summary).
        payload: s.payload,
      })),
  }));
  writeFileSync(join(dir, "pipeline-snapshot.json"), JSON.stringify({ generatedAt: new Date().toISOString(), deals: snapshot }, null, 1) + "\n");

  // Golden: one article each for 20 verified deals (≥ 2 publications agree, nothing disputed),
  // with a disclosed amount and a named stage, spread across sectors.
  // The article chosen for each deal must itself state the agreed values: its own extraction
  // (deal_sources.reported_*) matches the corroborated stage, amount (±2%) and lead set.
  const golden = await q<Record<string, unknown>>(`
    WITH v AS (
      SELECT d.id, c.canonical_name AS company, coalesce(c.aliases, '{}') AS aliases, d.round_stage, d.amount_usd::float8 AS amount_usd,
             d.fx_rate_used::float8 AS fx_rate, d.sector_primary,
             (SELECT coalesce(array_agg(DISTINCT i.canonical_name), '{}') FROM deal_investors di JOIN investors i ON i.id = di.investor_id WHERE di.deal_id = d.id AND di.role = 'lead') AS leads,
             row_number() OVER (PARTITION BY d.sector_primary ORDER BY d.corroboration_count DESC, d.announced_date DESC) AS rk
      FROM deals d JOIN companies c ON c.id = d.company_id
      WHERE d.is_verified AND NOT d.has_disputed_field AND d.amount_usd IS NOT NULL AND d.round_stage <> 'Undisclosed'
    )
    SELECT v.*, (
      SELECT json_build_object('url', ra.url, 'headline', ra.headline, 'publication', s.publication)
      FROM deal_sources s JOIN raw_articles ra ON ra.id = s.raw_article_id
      WHERE s.deal_id = v.id AND ra.body_text IS NOT NULL AND length(ra.body_text) > 400
        AND s.reported_stage = v.round_stage
        AND abs(s.reported_amount_usd::float8 - v.amount_usd) <= 0.02 * v.amount_usd
        AND cardinality(s.reported_investors_lead) > 0
      ORDER BY s.is_primary DESC, s.raw_article_id LIMIT 1) AS article
    FROM v ORDER BY v.rk, v.sector_primary`);
  const cases = golden
    .filter((g) => g.article)
    .slice(0, 20)
    .map((g) => ({
      article: g.article,
      expected: { company: g.company, aliases: g.aliases, stage: g.round_stage, amountUsd: g.amount_usd, fxRate: g.fx_rate, leads: g.leads, sector: g.sector_primary },
      basis: "the article's own figures, which two or more independent publications agree on (is_verified, no disputed field)",
    }));
  writeFileSync(join(dir, "golden-funding.json"), JSON.stringify({ generatedAt: new Date().toISOString(), cases }, null, 1) + "\n");
  logger.info("fixtures written", { snapshotDeals: snapshot.length, snapshotSources: sources.length, goldenCases: cases.length });
}
main().catch((err: unknown) => {
  logger.error("fixture build failed", { error: err instanceof Error ? err : String(err) });
  process.exit(1);
});
