import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { RegenerateButton } from "@/components/admin";
import { CapitalCountChart, Donut, HistogramChart, ShareLine, StageMixChart } from "@/components/charts";
import { SERIES } from "@/lib/chart-colors";
import { CountUp } from "@/components/count-up";
import { Gauge } from "@/components/gauge";
import { BarList, DealList } from "@/components/deals";
import { KpiTile } from "@/components/kpi";
import { Badge, Card, Empty, Icon, Loading, Page, ProfileSwitcher, Unavailable, WindowSelector } from "@/components/ui";
import { getAggregates } from "@/db/queries/aggregates";
import { bucketOf, getDealSizes, getProfileWeekly, getWeeklySeries, getWindowAlerts, getWindowStats, histogram, STAGE_GROUP_ORDER, STAGE_GROUPS } from "@/db/queries/dashboard";
import { getDealsByIds, queryDeals } from "@/db/queries/deals";
import { getLeaderboard } from "@/db/queries/investors";
import { dealFiltersSchema } from "@/lib/deal-filters";
import { delta, pct, RELATIONSHIP_TEXT, shortDate, usd } from "@/lib/format";
import { logger } from "@/lib/logger";
import { param, resolveProfile, resolveWindow, type SearchParams } from "@/lib/view";
import { toIsoDate } from "@/pipeline/normalize";

// Next.js requires page components to be default exports (DECISIONS.md D-008).

export const metadata = { title: "Overview · Startup Funding Pulse" };

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

  const windowCapital = agg.stages.rows.reduce((m, r) => {
    const g = STAGE_GROUPS[r.stage] ?? "Other";
    m.set(g, (m.get(g) ?? 0) + r.capital);
    return m;
  }, new Map<string, number>());
  const leadMax = Math.max(1, ...leaders.map((l) => l.deals));

  return (
    <>
      {/* Hero: the week in one line, with the primary call to action */}
      <section className="hero-grad animate-in relative overflow-hidden rounded-[1.75rem] p-6 text-white shadow-[0_20px_50px_-20px_rgb(79_70_229/0.6)] sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-white/15 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-cyan-300/20 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/80">
              <span className="live-dot" aria-hidden /> {win.label} · {active.displayName}
            </p>
            <h2 className="mt-2 text-3xl font-extrabold leading-tight sm:text-4xl">
              <span className="num">{stats.n}</span> deals · <span className="num">{usd(stats.capital, { undisclosed: "$0" })}</span> raised
            </h2>
            <p className="mt-2 text-sm text-white/85">
              {win.start} → {win.end}. {hitDeals.length} watchlist {hitDeals.length === 1 ? "hit" : "hits"}, {alerts.adjacency.length} adjacent {alerts.adjacency.length === 1 ? "raise" : "raises"} around your
              tracked companies, market temperature {agg.temperature.value}/100.
            </p>
          </div>
          <div className="no-print flex flex-col items-end gap-3">
            <RegenerateButton profileId={active.id} mode={mode} variant="light" />
            <div className="flex gap-2">
              <a href={`/brief/latest?profile=${active.id}`} className="btn btn-sm border border-white/40 bg-white/10 text-white backdrop-blur hover:bg-white/20">
                Read latest brief
              </a>
              <Link href={`/explorer?profile=${active.id}&from=${win.start}&to=${win.end}&sort=score`} className="btn btn-sm border border-white/40 bg-white/10 text-white backdrop-blur hover:bg-white/20">
                Explore deals →
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <ProfileSwitcher path="/" sp={sp} profiles={all} active={active} />
          <WindowSelector path="/" sp={sp} win={win} />
        </div>
        <p className="text-xs text-muted">
          Compared with {prev.start} → {prev.end} · last brief {active.lastDigestSentAt ? active.lastDigestSentAt.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "never sent"}
        </p>
      </div>

      {/* KPI row — 7 tiles with change vs previous window and 12-week sparklines */}
      <div className="stagger grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <KpiTile label="Deals" color="indigo" icon={Icon.list} value={<CountUp value={stats.n} />} delta={delta(stats.n, statsPrev.n)} spark={weekly.map((w) => w.n)} hint="Unique deduplicated deals announced in the window" />
        <KpiTile label="Total capital" color="violet" icon={Icon.chart} value={<CountUp value={stats.capital} format="usd" />} delta={delta(stats.capital, statsPrev.capital)} spark={weekly.map((w) => w.capital)} hint={`Sum of disclosed amounts; ${agg.totals.undisclosed_n} undisclosed deals excluded`} />
        <KpiTile label="Median cheque" color="cyan" icon={Icon.layers} value={stats.median === null ? "—" : <CountUp value={stats.median} format="usd" />} delta={stats.median !== null && statsPrev.median !== null ? delta(stats.median, statsPrev.median) : null} spark={weekly.map((w) => w.median)} hint={`Median of ${agg.totals.priced_n} priced deals`} goodWhenUp={null} />
        <KpiTile label="Watchlist hits" color="rose" icon={Icon.star} value={<CountUp value={stats.watchlistHits} />} delta={delta(stats.watchlistHits, statsPrev.watchlistHits, "abs")} spark={profileWeekly.map((w) => w.hits)} hint="Deals involving a company on this profile's watchlist" goodWhenUp={null} />
        <KpiTile label="Adjacency alerts" color="pink" icon={Icon.bell} value={<CountUp value={stats.adjacency} />} delta={delta(stats.adjacency, statsPrev.adjacency, "abs")} spark={profileWeekly.map((w) => w.adjacency)} hint="Raises adjacent to a tracked (simulated) portfolio company" goodWhenUp={null} />
        <KpiTile label="Active investors" color="emerald" icon={Icon.users} value={<CountUp value={stats.investors} />} delta={delta(stats.investors, statsPrev.investors)} spark={weekly.map((w) => w.investors)} hint="Distinct investors on deals in the window" />
        <KpiTile label="Temperature" color="amber" icon={Icon.flame} value={<CountUp value={agg.temperature.value} suffix="/100" />} delta={delta(agg.temperature.value, aggPrev.temperature.value, "abs")} spark={weekly.map((w) => w.temperature)} hint="Weighted z-scores of deal count, capital, early-stage share and breadth vs the trailing 8 weeks (50 = normal)" goodWhenUp={null} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" icon={Icon.chart} title="Capital and deal count" subtitle="Last 12 ISO weeks" n={weekly.reduce((s, w) => s + w.n, 0)} note="* current week is partial. Capital counts disclosed amounts only.">
          <CapitalCountChart data={weekly.map((w) => ({ week: w.week, capital: w.capital, n: w.n, partial: w.partial }))} />
        </Card>
        <Card icon={Icon.gauge} title="Market temperature" subtitle="This window vs the trailing 8 weeks" n={agg.temperature.n} note="Deal count and capital weigh 35% each; early-stage share and breadth 15% each. 50 means a normal week.">
          <Gauge value={agg.temperature.value} label="Market temperature" caption={`Deal count z ${agg.temperature.components.deal_count.z.toFixed(1)} · capital z ${agg.temperature.components.total_capital.z.toFixed(1)}`} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card icon={Icon.flame} title="Sector heat" subtitle="Ordered by capital" n={agg.sectors.n} note={<>▲/▼ deal count vs previous window. Gradient bars are core mandate sectors.</>}>
          {agg.sectors.rows.filter((s) => s.n > 0).length === 0 ? (
            <Empty>No deals in this window.</Empty>
          ) : (
            <BarList
              rows={agg.sectors.rows
                .filter((s) => s.n > 0)
                .slice(0, 8)
                .map((s) => ({
                  key: s.sector,
                  label: s.sector,
                  href: `/sectors/${encodeURIComponent(s.sector)}?profile=${active.id}`,
                  value: s.capital,
                  display: `${usd(s.capital, { undisclosed: "$0" })} · ${s.n}`,
                  highlight: core.has(s.sector),
                  indicator: s.wow_delta > 0 ? <span className="text-up">▲</span> : s.wow_delta < 0 ? <span className="text-down">▼</span> : <span className="text-muted">•</span>,
                }))}
            />
          )}
        </Card>
        <Card icon={Icon.pie} title="Capital by stage" subtitle="This window" n={agg.stages.priced_n} note="Disclosed capital grouped into early (angel to pre-Series A), Series A–B, late and other rounds.">
          {[...windowCapital.values()].some((v) => v > 0) ? (
            <>
              <Donut data={STAGE_GROUP_ORDER.map((g) => ({ name: g, value: windowCapital.get(g) ?? 0 }))} centerLabel="disclosed" centerValue={usd(agg.totals.capital_usd, { undisclosed: "$0" })} money />
              <ul className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
                {STAGE_GROUP_ORDER.map((g, i) => (
                  <li key={g} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: SERIES[i] }} />
                    <span className="text-muted">{g}</span>
                    <span className="ml-auto font-semibold tabular-nums">{usd(windowCapital.get(g) ?? 0, { undisclosed: "$0" })}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Empty>No priced deals in this window.</Empty>
          )}
        </Card>
        <Card icon={Icon.pin} title="Geography" subtitle="Deals by city" n={agg.cities.n} note={`${agg.cities.unreported_n} deals without a reported city. Gradient bars are primary geographies.`}>
          {agg.cities.rows.length === 0 ? (
            <Empty>No cities reported.</Empty>
          ) : (
            <BarList rows={agg.cities.rows.slice(0, 8).map((c) => ({ key: c.city, label: c.city, value: c.n, display: `${c.n} · ${pct(c.share_pct)}`, highlight: cfg.mandate.geographies_primary.includes(c.city) }))} />
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card icon={Icon.layers} title="Stage mix over time" subtitle="Share of disclosed capital, last 8 weeks" n={last8.reduce((s, w) => s + w.n, 0)}>
          <StageMixChart
            keys={[...STAGE_GROUP_ORDER]}
            data={last8.map((w) => ({ label: w.week.slice(5) + (w.partial ? "*" : ""), ...Object.fromEntries(STAGE_GROUP_ORDER.map((g) => [g, w.stageCapital[g] ?? 0])) }))}
          />
        </Card>
        <Card icon={Icon.grid} title="Deal-size distribution" subtitle={`Median ${usd(sizes.median, { undisclosed: "n/a" })}`} n={sizes.amounts.length} note={`${sizes.undisclosed} undisclosed deals not shown.`}>
          {sizes.amounts.length === 0 ? <Empty>No priced deals in this window.</Empty> : <HistogramChart data={histogram(sizes.amounts)} medianLabel={bucketOf(sizes.median)} />}
        </Card>
        <Card icon={Icon.pie} title="Capital concentration" subtitle="Top-3 rounds' share of capital" n={agg.concentration.n} note="Dashed line: 8-week baseline.">
          <div className="flex items-baseline gap-2">
            <p className="num text-gradient text-4xl font-extrabold">{pct(agg.concentration.top3_share * 100)}</p>
            <p className="text-xs text-muted">vs {pct(agg.concentration.baseline_top3_share * 100)} baseline</p>
          </div>
          <ShareLine data={weekly.map((w) => ({ week: w.week, value: w.top3Share }))} label="Top-3 share" baseline={agg.concentration.baseline_top3_share} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card icon={Icon.star} title="Watchlist hits" subtitle="Companies you watch that raised" n={hitDeals.length}>
          {hitDeals.length === 0 ? <Empty>No watchlist company raised in this window.</Empty> : <DealList deals={hitDeals} />}
        </Card>
        <Card icon={Icon.bell} title="Adjacency alerts" subtitle="Raises around your tracked companies" n={alerts.adjacency.length} note={<>Tracked companies are a simulated portfolio. <Link className="link" href={`/portfolio?profile=${active.id}`}>Portfolio view →</Link></>}>
          {alerts.adjacency.length === 0 ? (
            <Empty>No adjacent raises in this window.</Empty>
          ) : (
            <ul className="stagger space-y-2">
              {alerts.adjacency.slice(0, 8).map((a) => {
                const d = byId.get(a.dealId);
                const tone = a.relationship === "competitor" ? "border-l-rose-500" : a.relationship === "same_layer" ? "border-l-amber-500" : "border-l-indigo-400";
                return (
                  <li key={`${a.portfolioId}-${a.dealId}`} className={`rounded-xl border border-line/80 border-l-4 bg-card p-3 text-sm transition-shadow hover:shadow-md ${tone}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={a.relationship === "competitor" ? "bad" : a.relationship === "same_layer" ? "warn" : "accent"}>{RELATIONSHIP_TEXT[a.relationship] ?? a.relationship}</Badge>
                      <span className="font-semibold">{d?.company ?? a.dealId}</span>
                      <span className="text-xs text-muted">→ {a.portfolio}</span>
                      <span className="ml-auto text-xs font-semibold tabular-nums">{d ? usd(d.amountUsd) : ""}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">{a.rationale}</p>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                      <span>
                        {d?.stage} · {shortDate(a.announced)} · confidence {a.confidence.toFixed(2)}
                      </span>
                      {d?.sources[0] ? (
                        <a className="link" href={d.sources[0].url} target="_blank" rel="noopener noreferrer">
                          {d.sources[0].publication} ↗
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          icon={Icon.list}
          title={`Ranked deals for ${active.displayName}`}
          subtitle="Click a deal for its scorecard"
          n={ranked.total}
          action={
            <Link className="btn btn-secondary btn-sm" href={`/explorer?profile=${active.id}&from=${win.start}&to=${win.end}&sort=score`}>
              View all
            </Link>
          }
          note={<Link className="link" href={`/methodology?profile=${active.id}`}>How scores work</Link>}
        >
          {ranked.rows.length === 0 ? <Empty>No scored deals in this window.</Empty> : <DealList deals={ranked.rows} />}
        </Card>
        <Card icon={Icon.users} title="Investor leaderboard" subtitle="Most active this window" n={leaders.length}>
          {leaders.length === 0 ? (
            <Empty>No investor data in this window.</Empty>
          ) : (
            <ol className="space-y-2.5">
              {leaders.map((l, i) => (
                <li key={l.id} className="group">
                  <div className="mb-1 flex items-center gap-2 text-[13px]">
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-bold ${i < 3 ? "bg-grad text-white" : "bg-card-2 text-muted ring-1 ring-line"}`}>{i + 1}</span>
                    <Link className="min-w-0 flex-1 truncate font-medium transition-colors hover:text-accent" href={`/investors/${l.id}?profile=${active.id}`}>
                      {l.name}
                    </Link>
                    <span className="shrink-0 text-xs tabular-nums text-muted">
                      {l.deals} deals · {l.leadDeals} led
                    </span>
                  </div>
                  <span className="ml-8 block h-1.5 overflow-hidden rounded-full bg-line/60">
                    <span className="animate-grow block h-1.5 rounded-full bg-grad" style={{ width: `${(100 * l.deals) / leadMax}%`, animationDelay: `${i * 50}ms` }} />
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}

export default function Home({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Page eyebrow="Overview" title="This period" subtitle="Indian startup funding, ranked against your mandate. Every number links back to its sources.">
      <Suspense fallback={<Loading what="the dashboard" />}>
        <Dashboard searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}
