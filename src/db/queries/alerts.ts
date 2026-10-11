import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";

/** The alert log behind the in-app inbox (PRD §15.2 rule 6). */

export interface AlertRow {
  id: number;
  severity: string;
  triggerKey: string;
  title: string;
  body: string;
  status: string;
  reason: string | null;
  portfolio: string | null;
  dealId: string | null;
  sourceUrl: string | null;
  createdAt: string;
  sentAt: string | null;
}

export async function getAlertInbox(profileId: string, status: string | null, limit = 200): Promise<AlertRow[]> {
  const res = await getDb().execute(sql`
    SELECT a.id, a.severity, a.trigger_key, a.title, a.body, a.status, a.suppressed_reason, p.name AS portfolio, a.deal_id,
           coalesce((SELECT ds.url FROM deal_sources ds WHERE ds.deal_id = a.deal_id ORDER BY ds.is_primary DESC LIMIT 1),
                    (SELECT es.url FROM event_sources es WHERE es.event_id = a.event_id ORDER BY es.is_primary DESC LIMIT 1)) AS source_url,
           a.created_at::text, a.sent_at::text
    FROM alerts a LEFT JOIN portfolio p ON p.id = a.portfolio_id
    WHERE a.profile_id = ${profileId} ${status ? sql`AND a.status = ${status}` : sql``}
    ORDER BY date_trunc('day', a.created_at) DESC, CASE a.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, a.created_at DESC, a.id DESC
    LIMIT ${limit}`);
  return z
    .array(z.object({ id: z.coerce.number(), severity: z.string(), trigger_key: z.string(), title: z.string(), body: z.string(), status: z.string(), suppressed_reason: z.string().nullable(), portfolio: z.string().nullable(), deal_id: z.string().nullable(), source_url: z.string().nullable(), created_at: z.string(), sent_at: z.string().nullable() }))
    .parse(res.rows)
    .map((r) => ({ id: r.id, severity: r.severity, triggerKey: r.trigger_key, title: r.title, body: r.body, status: r.status, reason: r.suppressed_reason, portfolio: r.portfolio, dealId: r.deal_id, sourceUrl: r.source_url, createdAt: r.created_at, sentAt: r.sent_at }));
}

export async function getAlertCounts(profileId: string): Promise<Record<string, number>> {
  const res = await getDb().execute(sql`SELECT status, count(*)::int AS n FROM alerts WHERE profile_id = ${profileId} GROUP BY 1`);
  return Object.fromEntries(z.array(z.object({ status: z.string(), n: z.coerce.number() })).parse(res.rows).map((r) => [r.status, r.n]));
}

/** All-profile alert totals by status plus the latest alerts-stage run (for /health). */
export async function getAlertHealth(): Promise<{ byStatus: Record<string, number>; lastRun: string | null; lastRunStatus: string | null }> {
  const db = getDb();
  const [counts, run] = await Promise.all([
    db.execute(sql`SELECT status, count(*)::int AS n FROM alerts GROUP BY 1`),
    db.execute(sql`SELECT started_at::text AS at, status FROM run_logs WHERE stage = 'alerts' ORDER BY started_at DESC LIMIT 1`),
  ]);
  const r = (run.rows[0] as { at?: string; status?: string } | undefined) ?? {};
  return {
    byStatus: Object.fromEntries(z.array(z.object({ status: z.string(), n: z.coerce.number() })).parse(counts.rows).map((x) => [x.status, x.n])),
    lastRun: r.at ?? null,
    lastRunStatus: r.status ?? null,
  };
}
