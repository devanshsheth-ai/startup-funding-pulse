import { connection } from "next/server";
import { Suspense } from "react";
import {
  getPipelineFunnel,
  getArticleTotals,
  getLastSuccessfulCollect,
  getRunLogTail,
  getSourceHealth,
} from "@/db/queries/ingestion";
import { logger } from "@/lib/logger";

/**
 * /health v0 (PRD §18.9) — how an evaluator confirms the system is live.
 * Honest by construction: disabled sources show their reason, never-attempted
 * sources show "—" rather than 0%, and errors never render a stack trace.
 */

export const metadata = { title: "Health · Startup Funding Pulse" };

const CRON_UTC = { hour: 1, minute: 0 }; // mirrors vercel.json (06:30 IST); up to +59 min on Hobby

function nextCronRun(now = new Date()): Date {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), CRON_UTC.hour, CRON_UTC.minute));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST";
}

function pct(r: number | null): string {
  return r === null ? "—" : `${Math.round(r * 100)}%`;
}

function statusClass(s: string | null): string {
  switch (s) {
    case "ok":
      return "text-emerald-700 dark:text-emerald-400";
    case "empty":
    case "stale":
      return "text-amber-700 dark:text-amber-400";
    case "error":
      return "text-red-700 dark:text-red-400";
    default:
      return "opacity-60";
  }
}

async function loadHealth() {
  try {
    const [sources, totals, lastCollect, runs, funnel] = await Promise.all([
      getSourceHealth(),
      getArticleTotals(),
      getLastSuccessfulCollect(),
      getRunLogTail(20),
      getPipelineFunnel(),
    ]);
    const live24h = lastCollect !== null && Date.now() - lastCollect.getTime() < 24 * 3_600_000;
    return { sources, totals, lastCollect, runs, funnel, live24h, nextRun: nextCronRun() };
  } catch (err) {
    logger.error("health page query failed", { error: err instanceof Error ? err : String(err) });
    return null;
  }
}

async function HealthContent() {
  await connection();
  const data = await loadHealth();
  if (!data) {
    return (
      <p className="rounded border border-red-300 p-3 text-sm text-red-800 dark:border-red-800 dark:text-red-300">
        Health data is temporarily unavailable: the database could not be reached. This is reported as-is rather than
        hidden.
      </p>
    );
  }
  const { sources, totals, lastCollect, runs, funnel, live24h, nextRun } = data;
  {
    const enabled = sources.filter((s) => s.enabled);
    return (
      <>
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Raw articles" value={totals.total.toLocaleString("en-IN")} />
          <Stat label="Fetched last 24h" value={totals.last24h.toLocaleString("en-IN")} />
          <Stat label="Sources with articles" value={`${totals.sourcesWithArticles} / ${enabled.length} enabled`} />
          <Stat label="Awaiting filter" value={totals.pendingFilter.toLocaleString("en-IN")} />
        </section>

        <section className="space-y-1 text-sm">
          <p>
            Last successful collection: <strong>{fmt(lastCollect)}</strong>{" "}
            <span className={live24h ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>
              ({live24h ? "within 24h" : "not within 24h"})
            </span>
          </p>
          <p>
            Next scheduled run: <strong>{fmt(nextRun)}</strong>{" "}
            <span className="opacity-60">(Vercel Hobby cron, up to 59 min late)</span>
          </p>
          <p className="opacity-70">
            Article publish dates span {fmt(totals.oldestPublished)} → {fmt(totals.newestPublished)}.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">Pipeline funnel</h2>
          <ol className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Articles collected" value={funnel.articles.toLocaleString("en-IN")} />
            <Stat label="Relevant (Stage A)" value={funnel.relevant.toLocaleString("en-IN")} />
            <Stat label="Funding candidates (Stage B)" value={funnel.candidateDeals.toLocaleString("en-IN")} />
            <Stat label="Unique deals (after dedupe)" value={funnel.uniqueDeals.toLocaleString("en-IN")} />
            <Stat
              label="Dedupe reduction"
              value={funnel.dedupeReduction === null ? "— (n = 0)" : `${Math.round(funnel.dedupeReduction * 100)}%`}
            />
          </ol>
          <div className="mt-3 grid gap-1 text-sm">
            <p>
              Deals reported by 2+ publications: <strong>{funnel.multiSourceDeals}</strong> · Events (M&amp;A, fund closes,
              people moves…): <strong>{funnel.events}</strong> · Rejected candidates: {funnel.rejectedCandidates}
            </p>
            <p>
              Deal history: <strong>{funnel.dealWeeks}</strong> ISO weeks ({funnel.earliestDeal ?? "—"} →{" "}
              {funnel.latestDeal ?? "—"})
            </p>
            <p>
              Ingestion mode, deals:{" "}
              {funnel.dealsByMode.length === 0
                ? "none yet"
                : funnel.dealsByMode.map((m) => `${m.mode} ${m.n}`).join(" · ")}
              {" "}· events:{" "}
              {funnel.eventsByMode.length === 0
                ? "none yet"
                : funnel.eventsByMode.map((m) => `${m.mode} ${m.n}`).join(" · ")}
            </p>
            <p>
              Gemini, last 24h: {funnel.gemini24h.calls} calls · {funnel.gemini24h.tokens.toLocaleString("en-IN")} tokens ·
              Quarantine:{" "}
              {funnel.quarantineByStage.length === 0
                ? "empty"
                : funnel.quarantineByStage.map((q) => `${q.stage} ${q.n}`).join(" · ")}
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">Sources</h2>
          <div className="overflow-x-auto rounded border border-black/10 dark:border-white/15">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-black/[0.03] dark:bg-white/[0.05]">
                <tr>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Tier</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Success rate (n)</th>
                  <th className="px-3 py-2">Articles (24h)</th>
                  <th className="px-3 py-2">Last fetched</th>
                  <th className="px-3 py-2">Last error / note</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id} className="border-t border-black/5 align-top dark:border-white/10">
                    <td className="px-3 py-2">
                      {s.name}
                      <div className="text-xs opacity-60">{s.type}</div>
                    </td>
                    <td className="px-3 py-2">{s.tier}</td>
                    <td className={`px-3 py-2 ${statusClass(s.enabled ? s.lastStatus : "disabled")}`}>
                      {s.enabled ? (s.lastStatus ?? "not yet run") : s.lastStatus === "backfill_only" ? "backfill source" : "disabled"}
                    </td>
                    <td className="px-3 py-2">
                      {pct(s.successRate)} <span className="opacity-60">({s.attempts})</span>
                    </td>
                    <td className="px-3 py-2">
                      {s.articles} <span className="opacity-60">({s.articles24h})</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmt(s.lastFetchedAt)}</td>
                    <td className="max-w-xs px-3 py-2 text-xs opacity-80">{s.lastError ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">Run log (latest 20 stage runs)</h2>
          {runs.length === 0 ? (
            <p className="text-sm opacity-70">No pipeline runs recorded yet.</p>
          ) : (
            <div className="overflow-x-auto rounded border border-black/10 dark:border-white/15">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-black/[0.03] dark:bg-white/[0.05]">
                  <tr>
                    <th className="px-3 py-2">Started</th>
                    <th className="px-3 py-2">Stage</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">In → Out</th>
                    <th className="px-3 py-2">Gemini calls / tokens</th>
                    <th className="px-3 py-2">Run</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r, i) => (
                    <tr key={`${r.runId}-${r.stage}-${i}`} className="border-t border-black/5 dark:border-white/10">
                      <td className="px-3 py-2 whitespace-nowrap">{fmt(r.startedAt)}</td>
                      <td className="px-3 py-2">{r.stage}</td>
                      <td className={`px-3 py-2 ${statusClass(r.status === "partial" ? "empty" : r.status)}`}>{r.status}</td>
                      <td className="px-3 py-2">
                        {r.itemsIn ?? "—"} → {r.itemsOut ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {r.geminiCalls ?? 0} / {(r.geminiTokens ?? 0).toLocaleString("en-IN")}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs opacity-70">{r.runId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </>
    );
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-black/10 p-3 dark:border-white/15">
      <div className="text-xs uppercase tracking-wide opacity-60">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

export default function HealthPage() {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">System health</h1>
        <p className="text-sm opacity-70">
          Live ingestion status. Every figure below is computed from the database at request time.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm opacity-70">Loading health data…</p>}>
        <HealthContent />
      </Suspense>
    </main>
  );
}
