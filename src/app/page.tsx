import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { RegenerateButton } from "@/components/admin";
import { AdjacencyMap, type AdjacencyGroup } from "@/components/adjacency-map";
import { CapitalCountChart, Donut, HistogramChart, SectorTreemap, ShareLine, StageMixChart } from "@/components/charts";
import { Tabs } from "@/components/tabs";
import { SERIES } from "@/lib/chart-colors";
import { CountUp } from "@/components/count-up";
import { Gauge } from "@/components/gauge";
import { BarList, DealList } from "@/components/deals";
import { KpiTile, StatChip } from "@/components/kpi";
import { Card, Empty, Icon, InfoTip, Loading, Page, ProfileSwitcher, SectionHeading, Unavailable, WindowSelector } from "@/components/ui";
import { getAggregates } from "@/db/queries/aggregates";
import { bucketOf, getDealSizes, getWeeklySeries, getWindowAlerts, getWindowStats, histogram, STAGE_GROUP_ORDER, STAGE_GROUPS } from "@/db/queries/dashboard";
import { getDealsByIds, queryDeals } from "@/db/queries/deals";
import { getLeaderboard } from "@/db/queries/investors";
import { dealFiltersSchema } from "@/lib/deal-filters";
import { delta, pct, usd } from "@/lib/format";
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
  const alertDeals = await getDealsByIds([...new Set([...alerts.watchlistDealIds, ...alerts.adjacency.map((a) => a.dealId)])], active.id);
  return { now, all, active, win, prev, agg, aggPrev, stats, statsPrev, weekly, sizes, alerts, alertDeals, ranked, leaders };
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
  const { all, active, win, prev, agg, aggPrev, stats, statsPrev, weekly, sizes, alerts, alertDeals, ranked, leaders } = data;
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

  const sectorRows = agg.sectors.rows.filter((r) => r.n > 0);
  const maxSectorCap = Math.max(1, ...sectorRows.map((r) => r.capital));
  const treemap = sectorRows.map((r) => ({
    name: r.sector,
    size: r.capital > 0 ? r.capital : maxSectorCap * 0.03,
    capital: r.capital,
    n: r.n,
    delta: r.wow_delta,
    core: core.has(r.sector),
    href: `/sectors/${encodeURIComponent(r.sector)}?profile=${active.id}`,
  }));
  const groups: AdjacencyGroup[] = [...new Set(alerts.adjacency.map((a) => a.portfolio))]
    .map((portfolio) => ({
      portfolio,
      items: alerts.adjacency
        .filter((a) => a.portfolio === portfolio)
        .map((a) => {
          const d = byId.get(a.dealId);
          return { company: d?.company ?? a.dealId, relationship: a.relationship, amountUsd: d?.amountUsd ?? null, url: d?.sources[0]?.url ?? null, rationale: a.rationale, stage: d?.stage ?? "" };
        }),
    }))
    .sort((x, y) => y.items.length - x.items.length)
    .slice(0, 4);
  const top5 = ranked.rows.slice(0, 5);

  return (
    <>
      {/* Hero: the week in one line, with the primary call to action */}
      <section className="hero-grad animate-in relative overflow-hidden rounded-[1.75rem] p-7 text-white shadow-[0_20px_50px_-20px_rgb(79_70_229/0.6)] sm:p-10">
        <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-white/15 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-cyan-300/20 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-end justify-between gap-8">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/80">
              <span className="live-dot" aria-hidden /> {win.label} · {active.displayName}
            </p>
            <h2 className="mt-3 text-3xl font-extrabold leading-tight sm:text-[2.6rem]">
              <span className="num">{stats.n}</span> deals · <span className="num">{usd(stats.capital, { undisclosed: "$0" })}</span> raised
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-white/85">
              {hitDeals.length} watchlist {hitDeals.length === 1 ? "hit" : "hits"} · {alerts.adjacency.length} adjacent {alerts.adjacency.length === 1 ? "raise" : "raises"} around your tracked companies · market temperature {agg.temperature.value}/100
            </p>
          </div>
          <div className="no-print flex flex-col items-end gap-3">
            <RegenerateButton profileId={active.id} mode={mode} variant="light" />
            <div className="flex gap-2">
              <Link href={`/brief?profile=${active.id}`} className="btn btn-sm border border-white/40 bg-white/10 text-white backdrop-blur hover:bg-white/20">
                Read the brief
              </Link>
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
        <InfoTip label="About this window">
          {win.start} → {win.end}, compared with {prev.start} → {prev.end}. Last brief sent{" "}
          {active.lastDigestSentAt ? active.lastDigestSentAt.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "never"}.
        </InfoTip>
      </div>

      {/* ── Market pulse ─────────────────────────────────────────────── */}
      <SectionHeading title="Market pulse" subtitle="How Indian startup funding moved in this window" />
      <div className="stagger grid grid-cols-2 gap-5 lg:grid-cols-4">
        <KpiTile label="Deals" color="indigo" icon={Icon.list} value={<CountUp value={stats.n} />} delta={delta(stats.n, statsPrev.n)} spark={weekly.map((w) => w.n)} hint="Unique deduplicated deals announced in the window" />
        <KpiTile label="Total capital" color="violet" icon={Icon.chart} value={<CountUp value={stats.capital} format="usd" />} delta={delta(stats.capital, statsPrev.capital)} spark={weekly.map((w) => w.capital)} hint={`Sum of disclosed amounts; ${agg.totals.undisclosed_n} undisclosed deals excluded`} />
        <KpiTile label="Median cheque" color="cyan" icon={Icon.layers} value={stats.median === null ? "—" : <CountUp value={stats.median} format="usd" />} delta={stats.median !== null && statsPrev.median !== null ? delta(stats.median, statsPrev.median) : null} spark={weekly.map((w) => w.median)} hint={`Median of ${agg.totals.priced_n} priced deals`} goodWhenUp={null} />
        <KpiTile label="Market temperature" color="amber" icon={Icon.flame} value={<CountUp value={agg.temperature.value} suffix="/100" />} delta={delta(agg.temperature.value, aggPrev.temperature.value, "abs")} spark={weekly.map((w) => w.temperature)} hint="Weighted z-scores of deal count, capital, early-stage share and breadth vs the trailing 8 weeks (50 = normal)" goodWhenUp={null} />
      </div>
      <div className="stagger grid gap-4 sm:grid-cols-3">
        <StatChip label="Watchlist hits" color="rose" icon={Icon.star} value={stats.watchlistHits} delta={delta(stats.watchlistHits, statsPrev.watchlistHits, "abs")} hint="Deals involving a company on this profile's watchlist" />
        <StatChip label="Adjacency alerts" color="pink" icon={Icon.bell} value={stats.adjacency} delta={delta(stats.adjacency, statsPrev.adjacency, "abs")} hint="Raises adjacent to a tracked (simulated) portfolio company" />
        <StatChip label="Active investors" color="emerald" icon={Icon.users} value={stats.investors} delta={delta(stats.investors, statsPrev.investors)} hint="Distinct investors on deals in the window" goodWhenUp />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" icon={Icon.chart} title="Capital and deal count" subtitle="Last 12 weeks" n={weekly.reduce((s, w) => s + w.n, 0)} note="Bars: disclosed capital per ISO week. Line: number of deals. * marks the current, partial week.">
          <CapitalCountChart data={weekly.map((w) => ({ week: w.week, capital: w.capital, n: w.n, partial: w.partial }))} />
        </Card>
        <Card icon={Icon.gauge} title="Market temperature" subtitle="vs the trailing 8 weeks" n={agg.temperature.n} note={`50 means a normal week. Deal count and capital weigh 35% each; early-stage share and breadth 15% each. Deal count z ${agg.temperature.components.deal_count.z.toFixed(1)}, capital z ${agg.temperature.components.total_capital.z.toFixed(1)}.`}>
          <div className="grid h-full place-items-center pb-2">
            <Gauge value={agg.temperature.value} label="Market temperature" />
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" icon={Icon.grid} title="Where capital went" subtitle="Box size = capital · colour = change vs last window" n={agg.sectors.n} note="Green sectors added deals versus the previous window, red ones lost deals, grey stayed flat. Outlined boxes are your core mandate sectors. Sectors with only undisclosed rounds get a small box. Click a sector for its page.">
          {treemap.length === 0 ? <Empty>No deals in this window.</Empty> : <SectorTreemap data={treemap} />}
        </Card>
        <Card icon={Icon.pie} title="Capital by stage" subtitle="This window" n={agg.stages.priced_n} note="Disclosed capital grouped into early (angel to pre-Series A), Series A–B, late and other (debt, bridge, unnamed) rounds.">
          {[...windowCapital.values()].some((v) => v > 0) ? (
            <>
              <Donut data={STAGE_GROUP_ORDER.map((g) => ({ name: g, value: windowCapital.get(g) ?? 0 }))} centerLabel="disclosed" centerValue={usd(agg.totals.capital_usd, { undisclosed: "$0" })} money />
              <ul className="mt-4 grid grid-cols-2 gap-2 text-xs">
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
      </div>

      <Card icon={Icon.layers} title="Market structure" subtitle="Geography, stage mix, deal sizes and concentration" note="Each tab is computed in SQL from the same window. Capital figures use disclosed amounts only.">
        <Tabs
          tabs={[
            {
              label: "Geography",
              content:
                agg.cities.rows.length === 0 ? (
                  <Empty>No cities reported.</Empty>
                ) : (
                  <div className="max-w-3xl">
                    <BarList rows={agg.cities.rows.slice(0, 8).map((c) => ({ key: c.city, label: c.city, value: c.n, display: `${c.n} · ${pct(c.share_pct)}`, highlight: cfg.mandate.geographies_primary.includes(c.city) }))} />
                    <p className="mt-3 text-xs text-muted">{agg.cities.unreported_n} deals did not report a city. Gradient bars are your primary geographies.</p>
                  </div>
                ),
            },
            {
              label: "Stage mix over time",
              content: (
                <StageMixChart
                  keys={[...STAGE_GROUP_ORDER]}
                  data={last8.map((w) => ({ label: w.week.slice(5) + (w.partial ? "*" : ""), ...Object.fromEntries(STAGE_GROUP_ORDER.map((g) => [g, w.stageCapital[g] ?? 0])) }))}
                />
              ),
            },
            {
              label: "Deal sizes",
              content: sizes.amounts.length === 0 ? <Empty>No priced deals in this window.</Empty> : <HistogramChart data={histogram(sizes.amounts)} medianLabel={bucketOf(sizes.median)} />,
            },
            {
              label: "Concentration",
              content: (
                <div>
                  <div className="flex items-baseline gap-2">
                    <p className="num text-gradient text-4xl font-extrabold">{pct(agg.concentration.top3_share * 100)}</p>
                    <p className="text-sm text-muted">of capital went to the 3 largest rounds (baseline {pct(agg.concentration.baseline_top3_share * 100)})</p>
                  </div>
                  <ShareLine data={weekly.map((w) => ({ week: w.week, value: w.top3Share }))} label="Top-3 share" baseline={agg.concentration.baseline_top3_share} />
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* ── Your portfolio ───────────────────────────────────────────── */}
      <SectionHeading
        title="Your portfolio"
        subtitle="Raises around your tracked companies and on your watchlist"
        action={
          <Link className="btn btn-secondary btn-sm" href={`/portfolio?profile=${active.id}`}>
            Portfolio view →
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3" icon={Icon.bell} title="Adjacency map" subtitle="Who raised around your tracked companies" n={alerts.adjacency.length} note="Tracked companies are a simulated portfolio: real startups used to test adjacency detection, with no relationship implied. Each satellite is a raise that Gemini judged related after a vector shortlist; hover for the rationale, click for the source.">
          {groups.length === 0 ? <Empty>No adjacent raises in this window.</Empty> : <AdjacencyMap groups={groups} />}
        </Card>
        <Card className="lg:col-span-2" icon={Icon.star} title="Watchlist hits" subtitle="Companies you watch that raised" n={hitDeals.length}>
          {hitDeals.length === 0 ? <Empty>None of your watchlist companies raised in this window.</Empty> : <DealList deals={hitDeals.slice(0, 5)} />}
        </Card>
      </div>

      {/* ── Deals ────────────────────────────────────────────────────── */}
      <SectionHeading
        title="Deals"
        subtitle={`Ranked against ${active.displayName}'s mandate`}
        action={
          <Link className="btn btn-secondary btn-sm" href={`/methodology?profile=${active.id}`}>
            How scores work
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" icon={Icon.list} title="Top deals" subtitle="Click a deal for its scorecard" n={ranked.total}>
          {top5.length === 0 ? <Empty>No scored deals in this window.</Empty> : <DealList deals={top5} />}
          {ranked.total > top5.length ? (
            <div className="mt-5 text-center">
              <Link className="btn btn-primary" href={`/explorer?profile=${active.id}&from=${win.start}&to=${win.end}&sort=score`}>
                Show all {ranked.total} deals →
              </Link>
            </div>
          ) : null}
        </Card>
        <Card icon={Icon.users} title="Investor leaderboard" subtitle="Most active this window" n={leaders.length}>
          {leaders.length === 0 ? (
            <Empty>No investor data in this window.</Empty>
          ) : (
            <ol className="space-y-3.5">
              {leaders.slice(0, 8).map((l, i) => (
                <li key={l.id} className="group">
                  <div className="mb-1.5 flex items-center gap-2.5 text-[13px]">
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11px] font-bold ${i < 3 ? "bg-grad text-white" : "bg-card-2 text-muted ring-1 ring-line"}`}>{i + 1}</span>
                    <Link className="min-w-0 flex-1 truncate font-medium transition-colors hover:text-accent" href={`/investors/${l.id}?profile=${active.id}`}>
                      {l.name}
                    </Link>
                    <span className="shrink-0 text-xs tabular-nums text-muted">{l.deals} deals</span>
                  </div>
                  <span className="ml-9 block h-1.5 overflow-hidden rounded-full bg-line/60">
                    <span className="animate-grow block h-1.5 rounded-full bg-grad" style={{ width: `${(100 * l.deals) / leadMax}%`, animationDelay: `${i * 50}ms` }} />
                  </span>
                </li>
              ))}
            </ol>
          )}
          <div className="mt-5 text-center">
            <Link className="btn btn-secondary btn-sm" href={`/investors?profile=${active.id}`}>
              All investors →
            </Link>
          </div>
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
