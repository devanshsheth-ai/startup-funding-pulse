import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { RegenerateButton } from "@/components/admin";
import { AdjacencyMap, type AdjacencyGroup } from "@/components/adjacency-map";
import { CapitalCountChart, Donut, HistogramChart, SectorTreemap, ShareLine, StageMixChart } from "@/components/charts";
import { SERIES } from "@/lib/chart-colors";
import { CountUp } from "@/components/count-up";
import { Gauge, ZBars } from "@/components/gauge";
import { BarList, DealList } from "@/components/deals";
import { KpiTile } from "@/components/kpi";
import { Badge, Card, Empty, Icon, InfoTip, Loading, Page, ProfileSwitcher, SectionHeading, Unavailable, WindowSelector } from "@/components/ui";
import { getAggregates } from "@/db/queries/aggregates";
import { bucketOf, getDealSizes, getProfileWeekly, getWeeklySeries, getWindowAlerts, getWindowStats, histogram, STAGE_GROUP_ORDER, STAGE_GROUPS } from "@/db/queries/dashboard";
import { getDealsByIds, queryDeals, queryEvents } from "@/db/queries/deals";
import { getTracked, getWatchlist } from "@/db/queries/portfolio";
import { getPatternHistory } from "@/db/queries/trends";
import { getLeaderboard } from "@/db/queries/investors";
import { dealFiltersSchema, parseEventFilters } from "@/lib/deal-filters";
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
  const [profileWeekly, patternRows, events, watch, tracked] = await Promise.all([
    getProfileWeekly(active.id, weekly.map((w) => w.week)),
    getPatternHistory(active.id, 40),
    queryEvents(parseEventFilters({ from: win.start, to: win.end, limit: "8" })),
    getWatchlist(active.id),
    getTracked(active.id),
  ]);
  const latestWeek = patternRows[0]?.week ?? null;
  const patterns = patternRows.filter((p) => p.week === latestWeek);
  const alertDeals = await getDealsByIds([...new Set([...alerts.watchlistDealIds, ...alerts.adjacency.map((a) => a.dealId)])], active.id);
  return { now, all, active, win, prev, agg, aggPrev, stats, statsPrev, weekly, profileWeekly, sizes, alerts, alertDeals, ranked, leaders, patterns, latestWeek, events, watch, tracked };
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
  const { all, active, win, prev, agg, aggPrev, stats, statsPrev, weekly, profileWeekly, sizes, alerts, alertDeals, ranked, leaders, patterns, latestWeek, events, watch, tracked } = data;
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
  const top = ranked.rows.slice(0, 10);
  const watchedCompanies = watch.filter((w) => w.type === "company").sort((a, b) => (b.lastEvent ?? "").localeCompare(a.lastEvent ?? "")).slice(0, 6);

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
            <RegenerateButton key={active.id} profileId={active.id} mode={mode} variant="light" />
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
        <p className="flex items-center gap-1 text-xs text-muted">
          {win.start} → {win.end} vs {prev.start} → {prev.end}
          <InfoTip label="About this window">
            Every change shown (▲/▼) compares this window with the previous window of the same length. Last brief sent{" "}
            {active.lastDigestSentAt ? active.lastDigestSentAt.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "never"}.
          </InfoTip>
        </p>
      </div>

      {/* ── Market pulse ─────────────────────────────────────────────── */}
      <SectionHeading title="Market pulse" subtitle="How Indian startup funding moved in this window" />
      <div className="stagger grid grid-cols-2 gap-5 lg:grid-cols-4">
        <KpiTile label="Deals" color="indigo" icon={Icon.list} value={<CountUp value={stats.n} />} delta={delta(stats.n, statsPrev.n)} spark={weekly.map((w) => w.n)} hint="Unique deduplicated deals announced in the window" />
        <KpiTile label="Total capital" color="violet" icon={Icon.chart} value={<CountUp value={stats.capital} format="usd" />} delta={delta(stats.capital, statsPrev.capital)} spark={weekly.map((w) => w.capital)} hint={`Sum of disclosed amounts; ${agg.totals.undisclosed_n} undisclosed deals excluded`} />
        <KpiTile label="Median cheque" color="cyan" icon={Icon.layers} value={stats.median === null ? "—" : <CountUp value={stats.median} format="usd" />} delta={stats.median !== null && statsPrev.median !== null ? delta(stats.median, statsPrev.median) : null} spark={weekly.map((w) => w.median)} hint={`Median of ${agg.totals.priced_n} priced deals`} goodWhenUp={null} />
        <KpiTile label="Market temperature" color="amber" icon={Icon.flame} value={<CountUp value={agg.temperature.value} suffix="/100" />} delta={delta(agg.temperature.value, aggPrev.temperature.value, "abs")} spark={weekly.map((w) => w.temperature)} hint="Weighted z-scores of deal count, capital, early-stage share and breadth vs the trailing 8 weeks (50 = normal)" goodWhenUp={null} />
      </div>
      <div className="stagger grid gap-5 sm:grid-cols-3">
        <KpiTile label="Watchlist hits" color="rose" icon={Icon.star} value={<CountUp value={stats.watchlistHits} />} delta={delta(stats.watchlistHits, statsPrev.watchlistHits, "abs")} spark={profileWeekly.map((w) => w.hits)} hint="Deals involving a company on this profile's watchlist" goodWhenUp={null} />
        <KpiTile label="Adjacency alerts" color="pink" icon={Icon.bell} value={<CountUp value={stats.adjacency} />} delta={delta(stats.adjacency, statsPrev.adjacency, "abs")} spark={profileWeekly.map((w) => w.adjacency)} hint="Raises adjacent to a tracked (simulated) portfolio company" goodWhenUp={null} />
        <KpiTile label="Active investors" color="emerald" icon={Icon.users} value={<CountUp value={stats.investors} />} delta={delta(stats.investors, statsPrev.investors)} spark={weekly.map((w) => w.investors)} hint="Distinct investors on deals in the window" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" icon={Icon.chart} title="Capital and deal count" subtitle="Last 12 weeks · bars = disclosed capital, line = deals · * = current partial week" n={weekly.reduce((s, w) => s + w.n, 0)} note="Weekly totals use ISO weeks. Capital counts disclosed amounts only; rounds without an amount still count as deals.">
          <CapitalCountChart data={weekly.map((w) => ({ week: w.week, capital: w.capital, n: w.n, partial: w.partial }))} />
        </Card>
        <Card icon={Icon.gauge} title="Market temperature" subtitle="This window vs the trailing 8 weeks · 50 = normal" n={agg.temperature.n} note="Deal count and capital weigh 35% each; early-stage share and breadth (1 − top-3 share) 15% each. Each driver is a z-score against the previous 8 weeks.">
          <Gauge value={agg.temperature.value} label="Market temperature" />
          <div className="mt-5 border-t border-line/70 pt-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">What&apos;s driving it</p>
            <ZBars
              rows={[
                { label: "Deal count", z: agg.temperature.components.deal_count.z },
                { label: "Capital", z: agg.temperature.components.total_capital.z },
                { label: "Early-stage share", z: agg.temperature.components.early_stage_share.z },
                { label: "Breadth", z: agg.temperature.components.breadth.z, detail: "How evenly capital is spread across rounds" },
              ]}
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" icon={Icon.grid} title="Where capital went" subtitle="Box size = disclosed capital · green = more deals than last window, red = fewer, grey = flat · outlined = your core sectors" n={agg.sectors.n} note="Sectors with only undisclosed rounds get a small box so they stay visible. Click any sector for its page.">
          {treemap.length === 0 ? <Empty>No deals in this window.</Empty> : <SectorTreemap data={treemap} />}
        </Card>
        <Card icon={Icon.flame} title="Sector heat" subtitle="Ranked by capital · ▲/▼ deal count vs last window" n={agg.sectors.n} note="Gradient bars are your core mandate sectors.">
          {sectorRows.length === 0 ? (
            <Empty>No deals in this window.</Empty>
          ) : (
            <BarList
              rows={sectorRows.slice(0, 9).map((r) => ({
                key: r.sector,
                label: r.sector,
                href: `/sectors/${encodeURIComponent(r.sector)}?profile=${active.id}`,
                value: r.capital,
                display: `${r.capital > 0 ? usd(r.capital) : "undisclosed"} · ${r.n}`,
                highlight: core.has(r.sector),
                indicator: r.wow_delta > 0 ? <span className="text-up">▲</span> : r.wow_delta < 0 ? <span className="text-down">▼</span> : <span className="text-muted">•</span>,
              }))}
            />
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card icon={Icon.pie} title="Capital by stage" subtitle="Disclosed capital this window" n={agg.stages.priced_n} note="Early = angel to pre-Series A; Series A–B; Late = Series C and beyond; Other = debt, bridge and unnamed rounds.">
          {[...windowCapital.values()].some((v) => v > 0) ? (
            <>
              <Donut data={STAGE_GROUP_ORDER.map((g) => ({ name: g, value: windowCapital.get(g) ?? 0 }))} centerLabel="disclosed" centerValue={usd(agg.totals.capital_usd, { undisclosed: "$0" })} money height={200} />
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
        <Card icon={Icon.layers} title="Stage mix over time" subtitle="Share of disclosed capital by stage, last 8 weeks" n={last8.reduce((s, w) => s + w.n, 0)} note="Shows capital moving between early and late rounds week by week.">
          <StageMixChart
            keys={[...STAGE_GROUP_ORDER]}
            data={last8.map((w) => ({ label: w.week.slice(5) + (w.partial ? "*" : ""), ...Object.fromEntries(STAGE_GROUP_ORDER.map((g) => [g, w.stageCapital[g] ?? 0])) }))}
          />
        </Card>
        <Card icon={Icon.grid} title="Deal sizes" subtitle={`Distribution this window · median ${usd(sizes.median, { undisclosed: "n/a" })}`} n={sizes.amounts.length} note={`${sizes.undisclosed} undisclosed deals are not shown. The dashed line marks the median bucket.`}>
          {sizes.amounts.length === 0 ? <Empty>No priced deals in this window.</Empty> : <HistogramChart data={histogram(sizes.amounts)} medianLabel={bucketOf(sizes.median)} />}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card icon={Icon.pin} title="Geography" subtitle="Deals by city · gradient = your primary cities" n={agg.cities.n} note={`${agg.cities.unreported_n} deals did not report a city.`}>
          {agg.cities.rows.length === 0 ? (
            <Empty>No cities reported.</Empty>
          ) : (
            <BarList rows={agg.cities.rows.slice(0, 8).map((c) => ({ key: c.city, label: c.city, value: c.n, display: `${c.n} · ${pct(c.share_pct)}`, highlight: cfg.mandate.geographies_primary.includes(c.city) }))} />
          )}
        </Card>
        <Card icon={Icon.pie} title="Capital concentration" subtitle="Share of capital taken by the 3 largest rounds" n={agg.concentration.n} note="When one mega-round dominates, averages mislead. Dashed line: 8-week baseline.">
          <div className="flex items-baseline gap-2">
            <p className="num text-gradient text-4xl font-extrabold">{pct(agg.concentration.top3_share * 100)}</p>
            <p className="text-xs text-muted">vs {pct(agg.concentration.baseline_top3_share * 100)} baseline</p>
          </div>
          <ShareLine data={weekly.map((w) => ({ week: w.week, value: w.top3Share }))} label="Top-3 share" baseline={agg.concentration.baseline_top3_share} />
        </Card>
        <Card
          icon={Icon.star}
          title="Patterns this week"
          subtitle={latestWeek ? `Passed all 3 gates · ${latestWeek.slice(5)}` : "Statistical signals"}
          n={patterns.length}
          note="A pattern fires only with enough deals, a large enough effect and enough weeks of history. Suppressed detectors are listed on the methodology page."
          action={
            <Link className="btn btn-secondary btn-sm" href={`/trends?profile=${active.id}`}>
              History
            </Link>
          }
        >
          {patterns.length === 0 ? (
            <Empty>No pattern passed its gates this week.</Empty>
          ) : (
            <ul className="space-y-2.5">
              {patterns.slice(0, 6).map((p) => (
                <li key={p.id} className="rounded-xl bg-card-2 p-3 ring-1 ring-line/60" title={p.statement}>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${p.confidence === "strong" ? "bg-emerald-500" : p.confidence === "emerging" ? "bg-indigo-500" : "bg-slate-400"}`} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{p.title}</span>
                    {p.consecutiveWeeks > 1 ? <span className="shrink-0 text-[11px] font-semibold text-amber-600">×{p.consecutiveWeeks}</span> : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{p.statement}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

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
        <Card className="lg:col-span-3" icon={Icon.bell} title="Adjacency map" subtitle="Startups that raised around your tracked companies · circle size = amount" n={alerts.adjacency.length} note="Tracked companies are a simulated portfolio: real startups used to test adjacency detection, with no relationship implied. Each raise was shortlisted by vector similarity, then judged by Gemini; hover a circle for the reason, click for the source.">
          {groups.length === 0 ? (
            <Empty>No adjacent raises in this window.</Empty>
          ) : (
            <>
              <AdjacencyMap groups={groups} />
              <ul className="mt-5 divide-y divide-line/60 border-t border-line/70">
                {alerts.adjacency.slice(0, 6).map((a) => {
                  const d = byId.get(a.dealId);
                  const tone = a.relationship === "competitor" ? "bad" : a.relationship === "same_layer" ? "warn" : "accent";
                  return (
                    <li key={`${a.portfolioId}-${a.dealId}`} className="flex items-start gap-3 py-3 text-sm">
                      <Badge tone={tone}>{RELATIONSHIP_TEXT[a.relationship] ?? a.relationship}</Badge>
                      <div className="min-w-0 flex-1">
                        <p>
                          <span className="font-semibold">{d?.company ?? a.dealId}</span> <span className="text-muted">→ {a.portfolio}</span>
                          <span className="ml-2 text-xs font-semibold tabular-nums">{d ? `${usd(d.amountUsd)} · ${d.stage}` : ""}</span>
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">{a.rationale}</p>
                      </div>
                      {d?.sources[0] ? (
                        <a className="link shrink-0 text-xs" href={d.sources[0].url} target="_blank" rel="noopener noreferrer">
                          {d.sources[0].publication} ↗
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
        <div className="space-y-6 lg:col-span-2">
        <Card icon={Icon.layers} title="Tracked companies at a glance" subtitle="Adjacent raises this window, per tracked company" n={tracked.length} note="Competitor = same product for the same customer; same layer = different product competing for the same budget. Tracked companies are a simulated portfolio.">
          {tracked.length === 0 ? (
            <Empty>No tracked companies yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {tracked.map((t) => {
                const mine = alerts.adjacency.filter((a) => a.portfolioId === t.id);
                const comp = mine.filter((a) => a.relationship === "competitor").length;
                const layer = mine.filter((a) => a.relationship === "same_layer").length;
                return (
                  <li key={t.id} className="flex items-center gap-3 rounded-xl bg-card-2 px-3 py-2.5 ring-1 ring-line/60">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold text-white ${comp ? "bg-gradient-to-br from-rose-500 to-pink-500" : mine.length ? "bg-gradient-to-br from-amber-500 to-orange-500" : "bg-gradient-to-br from-slate-400 to-slate-500"}`}>{mine.length}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{t.name}</span>
                      <span className="block truncate text-xs text-muted">{t.sector}{t.subSector ? ` · ${t.subSector}` : ""}</span>
                    </span>
                    <span className="shrink-0 text-right text-[11px] leading-tight text-muted">
                      {comp ? <span className="block font-semibold text-down">{comp} competitor{comp === 1 ? "" : "s"}</span> : null}
                      {layer ? <span className="block font-semibold text-amber-600">{layer} same layer</span> : null}
                      {!comp && !layer ? <span>{mine.length ? "adjacent only" : "quiet"}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card icon={Icon.star} title="Watchlist" subtitle={hitDeals.length ? "Companies you watch that raised in this window" : "No watchlist company raised in this window"} n={hitDeals.length}>
          {hitDeals.length ? <DealList deals={hitDeals.slice(0, 5)} /> : null}
          <div className={hitDeals.length ? "mt-5 border-t border-line/70 pt-4" : ""}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Latest activity on your watchlist</p>
            {watchedCompanies.length === 0 ? (
              <p className="text-sm text-muted">The watchlist is empty. Add companies in settings.</p>
            ) : (
              <ul className="space-y-2">
                {watchedCompanies.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-2 rounded-xl bg-card-2 px-3 py-2 text-sm ring-1 ring-line/60">
                    <span className="min-w-0 truncate font-medium">{w.value}</span>
                    <span className="shrink-0 text-xs text-muted">{w.lastEvent ? `last raised ${shortDate(w.lastEvent)}${w.lastEventLabel ? ` · ${w.lastEventLabel}` : ""}` : "no round seen yet"}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link className="link mt-3 inline-block text-xs" href={`/settings?profile=${active.id}#watchlist`}>
              Manage watchlist →
            </Link>
          </div>
        </Card>
        </div>
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
        <Card className="lg:col-span-2" icon={Icon.list} title="Top deals" subtitle="Highest-scoring rounds · click any deal for its full scorecard" n={ranked.total} note="Scores run 0–100: sector, stage, cheque size, tracked investors, geography, recency and ecosystem significance, plus overrides for watchlist and adjacency.">
          {top.length === 0 ? <Empty>No scored deals in this window.</Empty> : <DealList deals={top} />}
          {ranked.total > top.length ? (
            <div className="mt-5 text-center">
              <Link className="btn btn-primary" href={`/explorer?profile=${active.id}&from=${win.start}&to=${win.end}&sort=score`}>
                Show all {ranked.total} deals →
              </Link>
            </div>
          ) : null}
        </Card>
        <div className="space-y-6">
          <Card icon={Icon.users} title="Investor leaderboard" subtitle="Most active this window" n={leaders.length}>
            {leaders.length === 0 ? (
              <Empty>No investor data in this window.</Empty>
            ) : (
              <ol className="space-y-3.5">
                {leaders.slice(0, 8).map((l, i) => (
                  <li key={l.id} className="group">
                    <div className="mb-1 flex items-center gap-2.5 text-[13px]">
                      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11px] font-bold ${i < 3 ? "bg-grad text-white" : "bg-card-2 text-muted ring-1 ring-line"}`}>{i + 1}</span>
                      <Link className="min-w-0 flex-1 truncate font-medium transition-colors hover:text-accent" href={`/investors/${l.id}?profile=${active.id}`}>
                        {l.name}
                      </Link>
                      <span className="shrink-0 text-xs tabular-nums text-muted">
                        {l.deals} deals · {l.leadDeals} led
                      </span>
                    </div>
                    <span className="ml-9 block h-1.5 overflow-hidden rounded-full bg-line/60">
                      <span className="animate-grow block h-1.5 rounded-full bg-grad" style={{ width: `${(100 * l.deals) / leadMax}%`, animationDelay: `${i * 50}ms` }} />
                    </span>
                    <p className="ml-9 mt-1 truncate text-[11px] text-muted">
                      {l.capitalLed > 0 ? `${usd(l.capitalLed)} led · ` : ""}
                      {l.sectors.join(", ")}
                    </p>
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
          <Card icon={Icon.layers} title="Exits, fund closes and people" subtitle="Events reported in this window" n={events.total}>
            {events.rows.length === 0 ? (
              <Empty>No events reported in this window.</Empty>
            ) : (
              <ul className="space-y-2.5">
                {events.rows.slice(0, 6).map((e) => (
                  <li key={e.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <Badge tone={e.type === "fund_close" ? "good" : e.type === "ma" ? "accent" : e.type === "shutdown" || e.type === "layoff" ? "bad" : "neutral"}>{e.type.replace("_", " ")}</Badge>
                      <span className="text-xs text-muted">{shortDate(e.date)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[13px] leading-snug">
                      {e.sources[0] ? (
                        <a className="hover:text-accent" href={e.sources[0].url} target="_blank" rel="noopener noreferrer">
                          {e.headline}
                        </a>
                      ) : (
                        e.headline
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <Link className="link mt-3 inline-block text-xs" href={`/explorer?tab=events&from=${win.start}&to=${win.end}`}>
              All events →
            </Link>
          </Card>
        </div>
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
