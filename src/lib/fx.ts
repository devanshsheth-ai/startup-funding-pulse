import { desc, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { fxRates } from "@/db/schema";
import { requireEnv } from "@/lib/env";
import { fetchText } from "@/lib/http";

/**
 * Daily USD→INR reference rates (ECB via Frankfurter by default; FX_API_URL).
 * Rates are cached in `fx_rates`; conversions use the rate for the announced
 * date, falling back to the nearest prior date (PRD §10 Stage C).
 */

const FX_SOURCE = "frankfurter-ecb";
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

const latestSchema = z.object({ date: z.string().regex(isoDate), rates: z.object({ INR: z.number().positive() }) });
const rangeSchema = z.object({
  rates: z.record(z.string().regex(isoDate), z.object({ INR: z.number().positive() })),
});

export interface FxRate {
  date: string;
  usdInr: number;
}

function base(): string {
  return requireEnv("FX_API_URL").replace(/\/+$/, "");
}

export function parseLatest(body: string): FxRate {
  const d = latestSchema.parse(JSON.parse(body));
  return { date: d.date, usdInr: d.rates.INR };
}

export function parseRange(body: string): FxRate[] {
  const d = rangeSchema.parse(JSON.parse(body));
  return Object.entries(d.rates)
    .map(([date, r]) => ({ date, usdInr: r.INR }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function upsertRates(rates: FxRate[]): Promise<number> {
  if (rates.length === 0) return 0;
  await getDb()
    .insert(fxRates)
    .values(rates.map((r) => ({ date: r.date, usdInr: String(r.usdInr), source: FX_SOURCE })))
    .onConflictDoUpdate({ target: fxRates.date, set: { usdInr: sql`excluded.usd_inr`, updatedAt: new Date() } });
  return rates.length;
}

export async function refreshLatestFx(): Promise<FxRate> {
  const { text } = await fetchText(`${base()}/latest?base=USD&symbols=INR`, { skipRobots: true });
  const rate = parseLatest(text);
  await upsertRates([rate]);
  return rate;
}

/** Fill a date range (inclusive, YYYY-MM-DD) — used by backfill. */
export async function refreshFxRange(from: string, to: string): Promise<number> {
  const { text } = await fetchText(`${base()}/${from}..${to}?base=USD&symbols=INR`, { skipRobots: true });
  return upsertRates(parseRange(text));
}

/** Nearest rate on or before `date`; null when no rate is cached that early. */
export async function rateOnOrBefore(date: string): Promise<FxRate | null> {
  const [row] = await getDb()
    .select({ date: fxRates.date, usdInr: fxRates.usdInr })
    .from(fxRates)
    .where(lte(fxRates.date, date))
    .orderBy(desc(fxRates.date))
    .limit(1);
  return row ? { date: row.date, usdInr: Number(row.usdInr) } : null;
}
