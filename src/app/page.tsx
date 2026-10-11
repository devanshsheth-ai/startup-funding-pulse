import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { RegenerateButton } from "@/components/admin";
import { CapitalCountChart, HistogramChart, ShareLine, StageMixChart } from "@/components/charts";
import { BarList, DealList } from "@/components/deals";
import { KpiTile } from "@/components/kpi";
import { Badge, Card, Empty, Loading, Page, ProfileSwitcher, Table, td, Unavailable, WindowSelector } from "@/components/ui";
import { getAggregates } from "@/db/queries/aggregates";
import { bucketOf, getDealSizes, getProfileWeekly, getWeeklySeries, getWindowAlerts, getWindowStats, histogram, STAGE_GROUP_ORDER } from "@/db/queries/dashboard";
import { getDealsByIds, queryDeals } from "@/db/queries/deals";
import { getLeaderboard } from "@/db/queries/investors";
import { dealFiltersSchema } from "@/lib/deal-filters";
import { delta, pct, RELATIONSHIP_TEXT, shortDate, usd } from "@/lib/format";
import { logger } from "@/lib/logger";
import { param, resolveProfile, resolveWindow, type SearchParams } from "@/lib/view";
import { toIsoDate } from "@/pipeline/normalize";

// Next.js requires page components to be default exports (DECISIONS.md D-008).

export const metadata = { title: "This period · Startup Funding Pulse" };

async function load(sp: Record<string, string | string[] | undefined>) {
  const now = new Date();
  const { all, active } = await resolveProfile(param(sp, "profile"));
  if (!active) return null;
  // The dashboard defaults to the last 7 days: right after a send the digest window is hours long (D-063).
  const win = resolveWindow(param(sp, "window") ?? "7d", active, now);
  const prevEnd = new Date(Date.parse(`${win.start}T00:00:00Z`) - 86_400_000);
  const prev = { start: toIsoDate(new Date(prevEnd.getTime() - (win.days - 1) * 86_400_000)), end: toIsoDate(prevEnd) };
  const [agg, aggPrev, stats, statsPrev, weekly, sizes, alerts, ranked, leaders] = await Promise.all([
    getAggregates(win),
    getAggregates(prev),
    getWindowStats(active.id, win.start, win.end),
    getWindowStats(active.id, prev.start, prev.end),
    getWeeklySeries(12, now),
    getDealSizes(win.start, win.end),
    getWindowAlerts(active.id, win.start, win.end),
    queryDeals(dealFiltersSchema.parse({ profile: active.id, from: win.start, to: win.end, tier: ["act_now", "high", "relevant", "context"], sort: "score", limit: 15 })),
    getLeaderboard(win.start, win.end, 10),
  ]);
  const profileWeekly = await getProfileWeekly(active.id, weekly.map((w) => w.week));
  const alertDeals = await getDealsByIds([...new Set([...alerts.watchlistDealIds, ...alerts.adjacency.map((a) => a.dealId)])], active.id);
  return { now, all, active, win, prev, agg, aggPrev, stats, statsPrev, weekly, profileWeekly, sizes, alerts, alertDeals, ranked, leaders };
}

async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  let data: Awaited<ReturnType<typeof load>>;
  try {
    data = await load(sp);
  } catch (err) {
    logger.error("dashboard load failed", { error: err instanceof Error ? err : String(err) });
    return <Unavailable what="The dashboard" />;
  }
  if (!data) return <Unavailable what="Profile data" />;
  const { all, active, win, prev, agg, aggPrev, stats, statsPrev, weekly, profileWeekly, sizes, alerts, alertDeals, ranked, leaders } = data;
  const cfg = active.config;
  const core = new Set(cfg.sectors_core.map((s) => s.name));
  const byId = new Map(alertDeals.map((d) => [d.id, d]));
  const hitDeals = alerts.watchlistDealIds.flatMap((id) => {
    const d = byId.get(id);
    return d ? [d] : [];
  });
  const last8 = weekly.slice(-8);
  const mode = cfg.delivery.mode === "daily" ? "daily" : "weekly";

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <ProfileSwitcher path="/" sp={sp} profiles={all} active={active} />
          <WindowSelector path="/" sp={sp} win={win} />
          <p className="text-xs text-muted">
            {win.label}: {win.start} → {win.end} ({win.days} days), compared with {prev.start} → {prev.end}. Last brief sent:{" "}
            {active.lastDigestSentAt ? active.lastDigestSentAt.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "never"}.
          </p>
        </div>
        <div className="no-print">
          <RegenerateButton profileId={active.id} mode={mode} />
        </div>
      </div>

      {/* KPI row — 7 tiles with change vs previous window and 12-week sparklines */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <KpiTile label="Deals" value={stats.n} delta={delta(stats.n, statsPrev.n)} spark={weekly.map((w) => w.n)} hint="Unique deduplicated deals announced in the window" />
        <KpiTile label="Total capital" value={usd(stats.capital, { undisclosed: "$0" })} delta={delta(stats.capital, statsPrev.capital)} spark={weekly.map((w) => w.capital)} hint={`Sum of disclosed amounts; ${agg.totals.undisclosed_n} undisclosed deals excluded`} />
        <KpiTile label="Median cheque" value={usd(stats.median, { undisclosed: "—" })} delta={stats.median !== null && statsPrev.median !== null ? delta(stats.median, statsPrev.median) : null} spark={weekly.map((w) => w.median)} hint={`Median of ${agg.totals.priced_n} priced deals`} goodWhenUp={null} />
        <KpiTile label="Watchlist hits" value={stats.watchlistHits} delta={delta(stats.watchlistHits, statsPrev.watchlistHits, "abs")} spark={profileWeekly.map((w) => w.hits)} hint="Deals involving a company on this profile's watchlist" goodWhenUp={null} />
        <KpiTile label="Adjacency alerts" value={stats.adjacency} delta={delta(stats.adjacency, statsPrev.adjacency, "abs")} spark={profileWeekly.map((w) => w.adjacency)} hint="Raises adjacent to a tracked (simulated) portfolio company" goodWhenUp={null} />
        <KpiTile label="Active investors" value={stats.investors} delta={delta(stats.investors, statsPrev.investors)} spark={weekly.map((w) => w.investors)} hint="Distinct investors on deals in the window" />
        <KpiTile label="Market temperature" value={`${agg.temperature.value}/100`} delta={delta(agg.temperature.value, aggPrev.temperature.value, "abs")} spark={weekly.map((w) => w.temperature)} hint="Weighted z-scores of deal count, capital, early-stage share and breadth vs the trailing 8 weeks (50 = normal)" goodWhenUp={null} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Capital and deal count, last 12 weeks" n={weekly.reduce((s, w) => s + w.n, 0)} note="* current week is partial. Capital counts disclosed amounts only.">
          <CapitalCountChart data={weekly.map((w) => ({ week: w.week, capital: w.capital, n: w.n, partial: w.partial }))} />
        </Card>
        <Card title="Sector heat" n={agg.sectors.n} note={<>Ordered by capital. ▲/▼ = deal count vs previous window. <span className="text-accent">■</span> core mandate sector.</>}>
          {agg.sectors.rows.filter((s) => s.n > 0).length === 0 ? (
            <Empty>No deals in this window.</Empty>
          ) : (
            <BarList
              rows={agg.sectors.rows
                .filter((s) => s.n > 0)
                .slice(0, 10)
                .map((s) => ({
                  key: s.sector,
                  label: s.sector,
                  href: `/sectors/${encodeURIComponent(s.sector)}`,
                  value: s.capital,
                  display: `${usd(s.capital, { undisclosed: "$0" })} · ${s.n}`,
                  highlight: core.has(s.sector),
                  indicator: s.wow_delta > 0 ? <span className="text-up">▲</span> : s.wow_delta < 0 ? <span className="text-down">▼</span> : <span className="text-muted">•</span>,
                }))}
            />
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Stage mix of capital, last 8 weeks" n={last8.reduce((s, w) => s + w.n, 0)} note="Share of disclosed capital by stage group per ISO week.">
          <StageMixChart
            keys={[...STAGE_GROUP_ORDER]}
            data={last8.map((w) => ({ label: w.week.slice(5) + (w.partial ? "*" : ""), ...Object.fromEntries(STAGE_GROUP_ORDER.map((g) => [g, w.stageCapital[g] ?? 0])) }))}
          />
        </Card>
        <Card title="Deal-size distribution" n={sizes.amounts.length} note={`Median ${usd(sizes.median, { undisclosed: "n/a" })}; ${sizes.undisclosed} undisclosed not shown.`}>
          {sizes.amounts.length === 0 ? <Empty>No priced deals in this window.</Empty> : <HistogramChart data={histogram(sizes.amounts)} medianLabel={bucketOf(sizes.median)} />}
        </Card>
        <Card title="Geography" n={agg.cities.n} note={`${agg.cities.unreported_n} deals without a reported city.`}>
          {agg.cities.rows.length === 0 ? (
            <Empty>No cities reported.</Empty>
          ) : (
            <BarList rows={agg.cities.rows.slice(0, 10).map((c) => ({ key: c.city, label: c.city, value: c.n, display: `${c.n} · ${pct(c.share_pct)}`, highlight: cfg.mandate.geographies_primary.includes(c.city) }))} />
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Capital concentration" n={agg.concentration.n} note="Share of disclosed capital taken by the three largest rounds. Dashed line: 8-week baseline.">
          <p className="text-3xl font-semibold tabular-nums">{pct(agg.concentration.top3_share * 100)}</p>
          <p className="mb-2 text-xs text-muted">top-3 share this window vs {pct(agg.concentration.baseline_top3_share * 100)} baseline</p>
          <ShareLine data={weekly.map((w) => ({ week: w.week, value: w.top3Share }))} label="Top-3 share" baseline={agg.concentration.baseline_top3_share} />
        </Card>
        <Card className="lg:col-span-2" title="Investor leaderboard" n={leaders.length}>
          {leaders.length === 0 ? (
            <Empty>No investor data in this window.</Empty>
          ) : (
            <Table head={["Investor", "Deals", "Led", "Capital led", "Sectors"]} minWidth={520}>
              {leaders.map((l) => (
                <tr key={l.id}>
                  <td className={td}>
                    <Link className="link" href={`/investors/${l.id}?profile=${active.id}`}>
                      {l.name}
                    </Link>
                  </td>
                  <td className={`${td} tabular-nums`}>{l.deals}</td>
                  <td className={`${td} tabular-nums`}>{l.leadDeals}</td>
                  <td className={`${td} tabular-nums`}>{usd(l.capitalLed, { undisclosed: "—" })}</td>
                  <td className={`${td} text-xs text-muted`}>{l.sectors.join(", ")}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="🔴 Watchlist hits" n={hitDeals.length}>
          {hitDeals.length === 0 ? <Empty>No watchlist company raised in this window.</Empty> : <DealList deals={hitDeals} />}
        </Card>
        <Card title="Adjacency alerts (tracked companies)" n={alerts.adjacency.length} note={<>Tracked companies are a simulated portfolio. <Link className="link" href={`/portfolio?profile=${active.id}`}>Portfolio view →</Link></>}>
          {alerts.adjacency.length === 0 ? (
            <Empty>No adjacent raises in this window.</Empty>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {alerts.adjacency.slice(0, 10).map((a) => {
                const d = byId.get(a.dealId);
                return (
                  <li key={`${a.portfolioId}-${a.dealId}`} className="py-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <Badge tone={a.relationship === "competitor" ? "bad" : a.relationship === "same_layer" ? "warn" : "neutral"}>{RELATIONSHIP_TEXT[a.relationship] ?? a.relationship}</Badge>
                      <span className="font-medium">{d?.company ?? a.dealId}</span>
                      <span className="text-muted">
                        → tracked company {a.portfolio} · {d ? `${d.stage} · ${usd(d.amountUsd)}` : ""} · {shortDate(a.announced)} · confidence {a.confidence.toFixed(2)}
                      </span>
                    </div>
                    <p className="text-xs text-muted">{a.rationale}</p>
                    {d?.sources[0] ? (
                      <a className="link text-xs" href={d.sources[0].url} target="_blank" rel="noopener noreferrer">
                        {d.sources[0].publication} ↗
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card title={`Ranked deals for ${active.displayName}`} n={ranked.total} note={<>Click a deal for its full scorecard. <Link className="link" href={`/explorer?profile=${active.id}&from=${win.start}&to=${win.end}&sort=score`}>All {ranked.total} in the explorer →</Link> · <Link className="link" href={`/methodology?profile=${active.id}`}>How scores work</Link></>}>
        {ranked.rows.length === 0 ? <Empty>No scored deals in this window.</Empty> : <DealList deals={ranked.rows} />}
      </Card>
    </>
  );
}

export default function Home({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Page title="This period" subtitle="Indian startup funding, ranked against your mandate. Every number links back to its sources.">
      <Suspense fallback={<Loading what="the dashboard" />}>
        <Dashboard searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}
