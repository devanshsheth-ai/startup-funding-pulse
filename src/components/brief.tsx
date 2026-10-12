import Link from "next/link";
import type { ReactNode } from "react";
import { AdjacencyMap, type AdjacencyGroup } from "@/components/adjacency-map";
import { PrintButton } from "@/components/auto-print";
import { Donut, SectorTreemap } from "@/components/charts";
import { BarList, DealList, type DealListItem } from "@/components/deals";
import { Gauge } from "@/components/gauge";
import { Badge, Icon, InfoTip, Tip } from "@/components/ui";
import { STAGE_GROUP_ORDER, STAGE_GROUPS } from "@/db/queries/dashboard";
import { SERIES } from "@/lib/chart-colors";
import { delta, shortDate, TIER_HELP, usd } from "@/lib/format";
import type { DealCard, DigestContent, EventItem } from "@/pipeline/digest";

/**
 * The web brief (PRD §18.10): the same stored content as the email, laid out
 * for reading — a KPI strip, a table of contents, an article column for the
 * analysis with source chips, and charts where the email can only show tables.
 */

const CONF: Record<string, { label: string; tone: "good" | "accent" | "neutral"; help: string }> = {
  strong: { label: "Strong", tone: "good", help: "Strong: a large effect on a solid sample, or the same signal several weeks running." },
  emerging: { label: "Emerging", tone: "accent", help: "Emerging: passed every gate, but on a modest sample or for the first time. Watch whether it repeats." },
  weak_signal: { label: "Weak signal", tone: "neutral", help: "Weak signal: only just passed the gates. Worth noting, not worth repeating to an LP yet." },
};

/** Deals shown per tier before "Show more". */
const TIER_PREVIEW = 6;

/** Spans the last card across both columns when a two-column grid has an odd count, so no hole is left. */
const oddLast = (i: number, n: number) => (n % 2 === 1 && i === n - 1 ? "md:col-span-2" : "");

function Section({ id, title, kicker, children, info, action }: { id: string; title: string; kicker?: string; children: ReactNode; info?: ReactNode; action?: ReactNode }) {
  return (
    <section id={id} className="card animate-in scroll-mt-24 p-6 sm:p-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          {kicker ? <p className="eyebrow mb-1">{kicker}</p> : null}
          <h2 className="text-2xl font-extrabold tracking-tight">{title}</h2>
        </div>
        <div className="no-print flex shrink-0 items-center gap-2">
          {action}
          {info ? <InfoTip>{info}</InfoTip> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub, tone, hint }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "up" | "down" | "flat"; hint: string }) {
  // On the gradient, rises read as mint and falls as soft rose.
  const t = tone === "up" ? "text-emerald-200" : tone === "down" ? "text-rose-200" : "text-white/80";
  return (
    <div className="rounded-2xl bg-white/[0.12] p-4 ring-1 ring-white/20">
      <Tip text={hint} className="cursor-help text-xs font-semibold uppercase tracking-wide text-white/75 underline decoration-white/40 decoration-dotted underline-offset-4">
        {label}
      </Tip>
      <div className="num mt-1 text-3xl font-extrabold text-white">{value}</div>
      {sub ? <div className={`mt-1 text-xs font-semibold ${t}`}>{sub}</div> : null}
    </div>
  );
}

function Chips({ ids, lookup }: { ids: string[]; lookup: Map<string, { company: string; url: string | null }> }) {
  const known = ids.filter((id) => lookup.get(id)?.url);
  const other = ids.length - known.length;
  if (ids.length === 0) return null;
  return (
    <span className="mt-2.5 flex flex-wrap items-center gap-1.5">
      {known.map((id) => {
        const e = lookup.get(id);
        return (
          <a key={id} href={e?.url ?? "#"} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent ring-1 ring-indigo-200 transition-colors hover:bg-indigo-100 dark:ring-indigo-500/30">
            {e?.company} ↗
          </a>
        );
      })}
      {other > 0 ? <span className="text-xs text-muted">{known.length ? `+${other} more` : `${other} cited deal${other === 1 ? "" : "s"}`}</span> : null}
    </span>
  );
}

function EventRow({ e }: { e: EventItem }) {
  const src = e.sources[0];
  return (
    <li className="flex gap-3 rounded-xl p-3 transition-colors hover:bg-card-2">
      <span className="w-14 shrink-0 pt-0.5 text-xs font-semibold text-muted">{shortDate(e.date)}</span>
      <span className="min-w-0 flex-1 text-[15px] leading-relaxed">
        {e.headline}
        {e.fundSizeUsd ? <span className="ml-1 font-semibold">· {usd(e.fundSizeUsd)}</span> : null}
        {e.mandateOverlap.length ? <span className="ml-2"><Badge tone="accent" title="This event touches sectors in your mandate, so it may affect companies you follow.">overlaps your mandate: {e.mandateOverlap.slice(0, 3).join(", ")}</Badge></span> : null}
      </span>
      {src ? (
        <a className="link shrink-0 text-xs" href={src.url} target="_blank" rel="noopener noreferrer">
          {src.publication} ↗
        </a>
      ) : null}
    </li>
  );
}

const asItems = (ds: DealCard[]): DealListItem[] => ds as unknown as DealListItem[];

export function BriefView({ c, shareUrl, actions }: { c: DigestContent; shareUrl: string; actions?: ReactNode }) {
  const weekly = c.mode === "weekly";
  const k = c.kpis;
  const dDeals = delta(k.deals, k.prevDeals);
  const dCap = delta(k.capitalUsd, k.prevCapitalUsd);

  // Evidence lookup: every deal and pattern evidence the brief knows about.
  const lookup = new Map<string, { company: string; url: string | null }>();
  const all: DealCard[] = [...c.watchlistHits, ...c.adjacency.map((a) => a.deal), ...c.ranked.act_now, ...c.ranked.high, ...c.ranked.relevant, ...c.serendipity];
  for (const d of all) lookup.set(d.id, { company: d.company, url: d.sources[0]?.url ?? null });
  for (const p of c.patterns) for (const e of p.evidence) if (!lookup.has(e.id)) lookup.set(e.id, { company: e.company, url: e.url });
  for (const e of [...c.exits, ...c.fundCloses, ...c.founders]) lookup.set(e.id, { company: e.headline.slice(0, 40) + (e.headline.length > 40 ? "…" : ""), url: e.sources[0]?.url ?? null });

  const groups: AdjacencyGroup[] = [...new Set(c.adjacency.map((a) => a.portfolio))]
    .map((portfolio) => ({
      portfolio,
      items: c.adjacency
        .filter((a) => a.portfolio === portfolio)
        .map((a) => ({ company: a.deal.company, relationship: a.relationship, amountUsd: a.deal.amountUsd, url: a.deal.sources[0]?.url ?? null, rationale: a.rationale, stage: a.deal.stage })),
    }))
    .sort((x, y) => y.items.length - x.items.length)
    .slice(0, 4);

  const maxCap = Math.max(1, ...c.sectorHeat.map((s) => s.capitalUsd));
  const treemap = c.sectorHeat
    .filter((s) => s.n > 0)
    .map((s) => ({ name: s.sector, size: s.capitalUsd > 0 ? s.capitalUsd : maxCap * 0.03, capital: s.capitalUsd, n: s.n, delta: s.wowDelta, core: s.mandate, href: `/sectors/${encodeURIComponent(s.sector)}?profile=${c.profile.id}` }));
  const stageCap = new Map<string, number>();
  for (const s of c.stages) stageCap.set(STAGE_GROUPS[s.stage] ?? "Other", (stageCap.get(STAGE_GROUPS[s.stage] ?? "Other") ?? 0) + s.capitalUsd);
  const tiers: { key: "act_now" | "high" | "relevant"; label: string; ring: string }[] = [
    { key: "act_now", label: "Act now", ring: "from-rose-500 to-pink-500" },
    { key: "high", label: "High", ring: "from-amber-500 to-orange-500" },
    { key: "relevant", label: "Relevant", ring: "from-indigo-500 to-violet-500" },
  ];
  const events = [...c.exits, ...c.fundCloses, ...c.founders];

  const toc: { id: string; label: string; show: boolean; hint: string }[] = [
    { id: "summary", label: "Summary", show: c.tldr.length > 0 || !!c.dailyContext, hint: "The three or four things to know if you read nothing else." },
    { id: "alerts", label: "Alerts", show: c.watchlistHits.length + c.adjacency.length + c.clusters.length + (c.heldAlerts?.length ?? 0) > 0, hint: "Watchlist hits and raises around your tracked companies." },
    { id: "analysis", label: "Analysis", show: c.narrative.length > 0, hint: "Written interpretation of the numbers, each paragraph citing its deals." },
    { id: "patterns", label: "Patterns", show: weekly, hint: "Statistical signals that passed all three gates this week." },
    { id: "deals", label: "Ranked deals", show: true, hint: "Every deal in the window, ranked by fit with your mandate." },
    { id: "market", label: "Market", show: c.sectorHeat.length > 0, hint: "Where the capital went by sector and stage." },
    { id: "investors", label: "Investors", show: weekly && c.investors.leaderboard.length > 0, hint: "Who was most active, who is new to your sectors, and who invests together." },
    { id: "serendipity", label: "Outside mandate", show: c.serendipity.length > 0, hint: "Significant deals outside your mandate, so the filter does not hide them." },
    { id: "events", label: "Events", show: events.length > 0, hint: "Exits, fund closes and people moves." },
    { id: "lp", label: "LP talking points", show: c.lpTalkingPoints.length + c.openQuestions.length > 0, hint: "Lines you can repeat to LPs, and questions the data cannot answer yet." },
  ];
  const exploreAll = `/explorer?profile=${c.profile.id}&from=${c.window.start}&to=${c.window.end}&sort=score`;
  const rankedTotal = c.ranked.act_now.length + c.ranked.high.length + c.ranked.relevant.length;
  const tierBar = [
    { key: "act_now", label: "Act now", n: c.ranked.act_now.length, cls: "from-rose-500 to-pink-500" },
    { key: "high", label: "High", n: c.ranked.high.length, cls: "from-amber-500 to-orange-500" },
    { key: "relevant", label: "Relevant", n: c.ranked.relevant.length, cls: "from-indigo-500 to-violet-500" },
    { key: "context", label: "Context", n: c.ranked.contextCount, cls: "from-slate-300 to-slate-400 dark:from-slate-600 dark:to-slate-500" },
  ];
  // Whatever the tiers above do not cover is archived (excluded sector or very low score), so the bar adds up to the window total.
  const archived = Math.max(0, c.counts.aggregatesN - tierBar.reduce((s, t) => s + t.n, 0));
  if (archived) tierBar.push({ key: "archive", label: "Archived", n: archived, cls: "from-slate-200 to-slate-200 dark:from-slate-700 dark:to-slate-700" });
  const tierTotal = tierBar.reduce((s, t) => s + t.n, 0);

  return (
    <div className="w-full">
      {/* Masthead */}
      <header className="hero-grad animate-in relative overflow-hidden rounded-[2rem] p-7 text-white shadow-[0_24px_60px_-24px_rgb(79_70_229/0.7)] sm:p-10">
        <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-white/15 blur-3xl" aria-hidden />
        <div className="relative">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/80">
              {weekly ? "Weekly brief" : "Daily note"} · {c.profile.name} · {c.window.start} → {c.window.end}
            </p>
            <div className="no-print flex flex-wrap gap-2">
              {actions ?? (
                <>
                  <PrintButton className="btn btn-sm border border-white/40 bg-white/15 text-white hover:bg-white/25" />
                  <Link href={`/brief?profile=${c.profile.id}`} className="btn btn-sm bg-white text-indigo-700 hover:bg-indigo-50">
                    Open in Dealscope →
                  </Link>
                </>
              )}
            </div>
          </div>
          <h1 className="mt-5 max-w-4xl text-3xl font-extrabold leading-[1.15] sm:text-[2.6rem]">{c.headline}</h1>
          <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Deals" value={k.deals} sub={`${dDeals.text} vs previous`} tone={dDeals.dir} hint="Unique funding rounds announced in this brief's window, compared with the window before it." />
            <Kpi label="Capital raised" value={usd(k.capitalUsd, { undisclosed: "$0" })} sub={`${dCap.text} vs previous`} tone={dCap.dir} hint="Sum of disclosed round sizes in US dollars. Rounds that did not disclose an amount add nothing." />
            <Kpi label="Median cheque" value={usd(k.medianUsd, { undisclosed: "—" })} sub={`${k.pricedDeals} priced deals`} hint="The middle round size among deals with a disclosed amount; one mega-round cannot distort it." />
            <Kpi label="Market temperature" value={`${k.temperature}/100`} sub={k.temperature >= 60 ? "Running hot" : k.temperature <= 40 ? "Running cool" : "About normal"} hint="How busy the market is versus the last 8 weeks: 50 = normal, 60+ = hot, 40 or less = cool." />
          </div>
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[220px_1fr]">
        {/* Table of contents */}
        <aside className="no-print hidden lg:block">
          <nav className="card sticky top-24 p-4 text-sm" aria-label="In this brief">
            <p className="eyebrow mb-3">In this brief</p>
            <ol className="space-y-1">
              {toc
                .filter((t) => t.show)
                .map((t, i) => (
                  <li key={t.id}>
                    <Tip block text={t.hint}>
                    <a href={`#${t.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-muted transition-colors hover:bg-accent-soft hover:text-accent">
                      <span className="grid h-5 w-5 place-items-center rounded-md bg-card-2 text-[10px] font-bold ring-1 ring-line">{i + 1}</span>
                      {t.label}
                    </a>
                    </Tip>
                  </li>
                ))}
            </ol>
            <div className="mt-4 border-t border-line pt-3 text-xs text-muted">
              Generated {c.generatedAt.slice(0, 16).replace("T", " ")} UTC ·{" "}
              <Link className="link" href={exploreAll}>
                {c.counts.aggregatesN} deals in window
              </Link>
              {c.narrationStatus === "degraded" ? <p className="mt-2 text-amber-600">Written analysis unavailable for this brief; all figures shown are computed directly.</p> : null}
            </div>
          </nav>
        </aside>

        <div className="min-w-0 space-y-8">
          {/* Summary */}
          {c.tldr.length || c.dailyContext ? (
            <Section id="summary" title="The short version" kicker="Summary" info="Written by Gemini from the numbers in this brief. Every figure in it comes from the database, not from the model.">
              {c.tldr.length ? (
                <ol className="grid gap-4 md:grid-cols-2">
                  {c.tldr.map((t, i) => (
                    <li key={i} className={`flex gap-4 rounded-2xl bg-card-2 p-5 ring-1 ring-line/60 ${oddLast(i, c.tldr.length)}`}>
                      <span className="bg-grad grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-extrabold text-white">{i + 1}</span>
                      <p className="text-[16px] leading-relaxed">{t}</p>
                    </li>
                  ))}
                </ol>
              ) : null}
              {c.dailyContext ? (
                <div className="mt-4 rounded-2xl bg-card-2 p-5 ring-1 ring-line/60">
                  <p className="text-[17px] leading-[1.75]">{c.dailyContext.text}</p>
                  <p className="mt-2 text-xs text-muted">Basis: {c.dailyContext.statBasis}</p>
                  <Chips ids={c.dailyContext.evidenceDealIds} lookup={lookup} />
                </div>
              ) : null}
            </Section>
          ) : null}

          {/* Alerts */}
          {c.watchlistHits.length + c.adjacency.length + c.clusters.length + (c.heldAlerts?.length ?? 0) > 0 ? (
            <Section id="alerts" title="What needs your attention" kicker="Alerts" info="Watchlist hits are companies you watch that raised. Adjacency raises are startups Gemini judged related to a tracked (simulated) portfolio company after a vector shortlist.">
              {c.clusters.length ? (
                <div className="mb-6 space-y-2">
                  {c.clusters.map((cl) => (
                    <div key={cl.portfolio} className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-gradient-to-r from-rose-50 to-orange-50 p-4 dark:border-rose-500/30 dark:from-rose-500/10 dark:to-orange-500/10">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300">{Icon.bell}</span>
                      <p className="text-[15px] leading-relaxed">
                        <strong>Cluster around {cl.portfolio}:</strong> {cl.deals.length} competitor or same-layer companies raised within {cl.windowDays} days —{" "}
                        {cl.deals.map((d) => d.company).join(", ")}.
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
              {groups.length ? <AdjacencyMap groups={groups} /> : null}
              {c.watchlistHits.length ? (
                <div className="mt-6">
                  <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">Watchlist</h3>
                  <DealList deals={asItems(c.watchlistHits)} />
                </div>
              ) : null}
              {c.heldAlerts?.length ? (
                <div className="mt-6">
                  <h3 className="mb-3 flex items-center gap-1 text-sm font-bold uppercase tracking-wide text-muted">
                    Also flagged
                    <InfoTip label="About these alerts">Alerts that were not emailed on their own (daily cap, cooldown or below the instant-alert severity), so they are folded into this brief instead.</InfoTip>
                  </h3>
                  <ul className="grid gap-2 md:grid-cols-2">
                    {c.heldAlerts.map((h, i) => (
                      <li key={h.id} className={`rounded-xl bg-card-2 p-3 text-sm ring-1 ring-line/60 ${oddLast(i, c.heldAlerts?.length ?? 0)}`}>
                        <p className="font-semibold">{h.title}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted">{h.body}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Section>
          ) : null}

          {/* Analysis */}
          {c.narrative.length ? (
            <Section id="analysis" title="What the numbers say" kicker="Analysis" info="Written by Gemini from aggregates computed in SQL. Every paragraph must cite deals that appear in this brief; paragraphs without valid evidence are removed before publishing.">
              <div className="mx-auto max-w-[68ch] space-y-7">
                {c.narrative.map((p, i) => {
                  const conf = CONF[p.confidence] ?? CONF.emerging!;
                  return (
                    <article key={i} className="border-l-4 border-indigo-200 pl-5 dark:border-indigo-500/40">
                      <div className="mb-2 flex items-center gap-2">
                        <Badge tone={conf.tone} title={conf.help}>
                          {conf.label}
                        </Badge>
                        <Tip text="The computed statistic this paragraph is based on.">
                          <span className="cursor-help text-xs text-muted">{p.statBasis}</span>
                        </Tip>
                      </div>
                      <p className="text-[17px] leading-[1.8]">{p.claim}</p>
                      <Chips ids={[...p.evidenceDealIds, ...p.evidenceEventIds]} lookup={lookup} />
                    </article>
                  );
                })}
              </div>
            </Section>
          ) : null}

          {/* Patterns */}
          {weekly ? (
            <Section id="patterns" title="Patterns this week" kicker="Signals" info="Each pattern passed three gates — sample size, effect size and weeks of history. Detectors without enough history are listed as suppressed rather than guessed.">
              {c.patterns.length === 0 ? (
                <p className="text-muted">No detector passed all three gates this week.</p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {c.patterns.map((p, i) => {
                    const conf = CONF[p.confidence] ?? CONF.emerging!;
                    return (
                      <div key={p.key + p.title} className={`card-hover relative rounded-2xl bg-card-2 p-5 ring-1 ring-line/60 ${oddLast(i, c.patterns.length)}`}>
                        <div className={`absolute inset-y-0 left-0 w-1.5 rounded-l-2xl ${p.confidence === "strong" ? "bg-emerald-500" : p.confidence === "emerging" ? "bg-indigo-500" : "bg-slate-400"}`} />
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Badge tone={conf.tone} title={conf.help}>
                            {conf.label}
                          </Badge>
                          {p.consecutiveWeeks > 1 ? (
                            <Badge tone="warn" title={`This detector has fired ${p.consecutiveWeeks} weeks in a row, so it is a trend rather than a blip.`}>
                              {p.consecutiveWeeks} weeks running
                            </Badge>
                          ) : null}
                          <Tip text="Sample size: how many deals the statistic was computed from.">
                            <span className="cursor-help text-xs text-muted">n = {p.sampleSize}</span>
                          </Tip>
                        </div>
                        <h3 className="text-[16px] font-bold leading-snug">{p.title}</h3>
                        <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{p.statement}</p>
                        <Chips ids={p.evidence.map((e) => e.id)} lookup={lookup} />
                      </div>
                    );
                  })}
                </div>
              )}
              {c.suppressedDetectors.length ? (
                <p className="mt-4 text-xs text-muted">
                  Suppressed for insufficient history: {c.suppressedDetectors.map((s) => s.key.replace(/_/g, " ")).join(", ")}.
                </p>
              ) : null}
            </Section>
          ) : null}

          {/* Ranked deals */}
          <Section
            id="deals"
            title="Ranked deals"
            kicker="Deals"
            info="Scored 0–100 against the profile's mandate: sector, stage, cheque size, tracked investors, geography, recency and ecosystem significance, plus overrides. Open a deal for its full scorecard."
            action={
              <Link className="btn btn-secondary btn-sm" href={exploreAll}>
                All {c.counts.aggregatesN} deals →
              </Link>
            }
          >
            <div className="space-y-6">
              {/* How the window's deals split across tiers */}
              {tierTotal ? (
              <div className="rounded-2xl bg-card-2 p-4 ring-1 ring-line/60">
                <div className="mb-2 flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-bold">How {tierTotal} deals scored</span>
                  <span className="text-xs text-muted">hover a band for what it means</span>
                </div>
                <div className="flex h-4 w-full gap-0.5">
                  {tierBar
                    .filter((t) => t.n > 0)
                    .map((t) => (
                      <span key={t.key} className="min-w-[8px]" style={{ width: `${(100 * t.n) / tierTotal}%` }}>
                        <Tip block text={`${t.n} deal${t.n === 1 ? "" : "s"} · ${TIER_HELP[t.key] ?? t.label}`}>
                          <span className={`animate-grow block h-4 rounded-md bg-gradient-to-r ${t.cls}`} />
                        </Tip>
                      </span>
                    ))}
                </div>
                <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                  {tierBar.map((t) => (
                    <li key={t.key} className="flex items-center gap-1.5">
                      <span className={`h-2.5 w-2.5 rounded-full bg-gradient-to-r ${t.cls}`} />
                      <span className="text-muted">{t.label}</span>
                      <span className="font-semibold tabular-nums">{t.n}</span>
                    </li>
                  ))}
                </ul>
              </div>
              ) : null}
              {tiers.map((t) => {
                const list = c.ranked[t.key];
                if (!list.length) return null;
                const rest = list.slice(TIER_PREVIEW);
                return (
                  <div key={t.key}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full bg-gradient-to-r ${t.ring}`} />
                      <Tip text={TIER_HELP[t.key] ?? ""}>
                        <h3 className="cursor-help text-sm font-bold uppercase tracking-wide">{t.label}</h3>
                      </Tip>
                      <span className="text-xs text-muted">{list.length}</span>
                    </div>
                    <DealList deals={asItems(list.slice(0, TIER_PREVIEW))} />
                    {rest.length ? (
                      <details className="group/more mt-2">
                        <summary className="no-print flex cursor-pointer list-none justify-center [&::-webkit-details-marker]:hidden">
                          <span className="btn btn-secondary btn-sm">
                            <span className="group-open/more:hidden">
                              Show {rest.length} more {t.label.toLowerCase()} deal{rest.length === 1 ? "" : "s"}
                            </span>
                            <span className="hidden group-open/more:inline">Show fewer</span>
                          </span>
                        </summary>
                        <div className="mt-2">
                          <DealList deals={asItems(rest)} />
                        </div>
                      </details>
                    ) : null}
                  </div>
                );
              })}
              {rankedTotal === 0 ? <p className="text-muted">No deals reached the relevant tier in this window.</p> : null}
              <div className="no-print flex flex-col items-center gap-2 rounded-2xl border border-dashed border-indigo-200 bg-accent-soft/50 p-5 text-center dark:border-indigo-500/30">
                <p className="text-sm text-muted">
                  {c.ranked.contextCount ? `${c.ranked.contextCount} more deals scored as context only and are not listed above. ` : ""}See every deal from {shortDate(c.window.start)} to {shortDate(c.window.end)}, with filters, sorting and CSV export.
                </p>
                <Link className="btn btn-primary" href={exploreAll}>
                  See all {c.counts.aggregatesN} deals in this window →
                </Link>
              </div>
            </div>
          </Section>

          {/* Market */}
          {c.sectorHeat.length ? (
            <Section id="market" title="Where the money went" kicker="Market" info="Sector boxes are sized by disclosed capital and coloured by the change in deal count versus the previous window. Outlined boxes are core mandate sectors.">
              <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
                <div className="flex flex-col rounded-2xl bg-card-2 p-3 ring-1 ring-line/60">
                  <SectorTreemap fill data={treemap} height={320} />
                </div>
                <div className="space-y-6">
                  <div className="rounded-2xl bg-card-2 p-4 ring-1 ring-line/60">
                    <p className="mb-2 flex items-center gap-1 text-sm font-bold">
                      Capital by stage
                      <InfoTip label="About stages">Early = angel to pre-Series A; Series A–B; Late = Series C and beyond; Other = debt, bridge and unnamed rounds.</InfoTip>
                    </p>
                    <Donut data={STAGE_GROUP_ORDER.map((g) => ({ name: g, value: stageCap.get(g) ?? 0 }))} centerLabel="disclosed" centerValue={usd(k.capitalUsd, { undisclosed: "$0" })} money height={190} />
                    <ul className="mt-3 grid grid-cols-2 gap-1.5 text-xs">
                      {STAGE_GROUP_ORDER.map((g, i) => (
                        <li key={g} className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: SERIES[i] }} />
                          <span className="text-muted">{g}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-2xl bg-card-2 p-4 ring-1 ring-line/60">
                    <Gauge value={k.temperature} label="Market temperature" />
                  </div>
                </div>
              </div>
            </Section>
          ) : null}

          {/* Investors */}
          {weekly && c.investors.leaderboard.length ? (
            <Section id="investors" title="Who wrote the cheques" kicker="Investors" info="Counted from the investors named on this window's deals. “Led” means the investor was reported as the lead. Click a name on the Investors page for its full history.">
              <div className="grid gap-8 lg:grid-cols-2">
                <div>
                  <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-muted">Most active</h3>
                  <BarList rows={c.investors.leaderboard.map((l) => ({ key: l.investor, label: l.investor, value: l.deals, display: `${l.deals} deals · ${l.leadDeals} led`, highlight: true }))} />
                </div>
                <div className="space-y-5">
                  {c.investors.newEntrants.length ? (
                    <div>
                      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">New to your sectors</h3>
                      <ul className="space-y-2">
                        {c.investors.newEntrants.map((n, i) => (
                          <li key={i} className="rounded-xl bg-card-2 p-3 text-[14px] leading-relaxed ring-1 ring-line/60">
                            {n.statement}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {c.investors.syndicates.length ? (
                    <div>
                      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Frequent co-investors</h3>
                      <div className="flex flex-wrap gap-2">
                        {c.investors.syndicates.map((s) => (
                          <span key={s.a + s.b} className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
                            {s.a} + {s.b} · {s.together}×
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {c.investors.inMandate.length ? (
                    <div>
                      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Active in your sectors</h3>
                      <p className="text-[14px] leading-relaxed text-muted">{c.investors.inMandate.map((i) => `${i.investor} (${i.deals})`).join(" · ")}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            </Section>
          ) : null}

          {/* Serendipity */}
          {c.serendipity.length ? (
            <Section id="serendipity" title="Outside your mandate, worth knowing" kicker="Serendipity" info="We deliberately surface the most significant deals that did not match your mandate, because a perfect filter would recreate the blind spot this product exists to fix.">
              <DealList deals={asItems(c.serendipity)} showScore={false} />
            </Section>
          ) : null}

          {/* Events */}
          {events.length ? (
            <Section id="events" title="Exits, fund closes and people" kicker="Events" info="Non-funding news from the same sources: acquisitions, shutdowns, IPO filings, layoffs, people moves and new fund closes.">
              <ul className="divide-y divide-line/60">
                {events.slice(0, 14).map((e) => (
                  <EventRow key={e.id} e={e} />
                ))}
              </ul>
            </Section>
          ) : null}

          {/* LP talking points */}
          {c.lpTalkingPoints.length + c.openQuestions.length > 0 ? (
            <Section id="lp" title="For your LP conversations" kicker="Talking points" info="Short lines built only from this brief's numbers, safe to repeat. Open questions are things the data cannot answer yet.">
              <div className="grid gap-4 md:grid-cols-2">
                {c.lpTalkingPoints.map((t, i) => (
                  <blockquote key={i} className={`bg-grad-soft rounded-2xl p-5 text-[16px] font-medium leading-relaxed ring-1 ring-indigo-100 dark:ring-indigo-500/20 ${oddLast(i, c.lpTalkingPoints.length)}`}>
                    “{t}”
                  </blockquote>
                ))}
              </div>
              {c.openQuestions.length ? (
                <div className="mt-6">
                  <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Open questions</h3>
                  <ul className="list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed">
                    {c.openQuestions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Section>
          ) : null}

          <footer className="rounded-2xl bg-card-2 p-5 text-xs leading-relaxed text-muted ring-1 ring-line/60">
            <p>{c.disclosure}</p>
            <p className="mt-2">
              Window {c.window.start} → {c.window.end} · {c.counts.aggregatesN} deals · generated {c.generatedAt.slice(0, 16).replace("T", " ")} UTC ·{" "}
              <a className="link" href={shareUrl}>
                shareable link
              </a>{" "}
              ·{" "}
              <Link className="link" href={`/methodology?profile=${c.profile.id}`}>
                how deals are ranked
              </Link>
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}
