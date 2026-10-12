import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { WeekLines } from "@/components/charts";
import { BarList } from "@/components/deals";
import { Badge, Card, Empty, Loading, Page, Pills, ProfileSwitcher, Table, td } from "@/components/ui";
import { addWeeks, weekOf, weeksBetween } from "@/db/queries/detection";
import { getLastDealBySector, getPatternHistory, getSectorWeekGrid, getStageVelocity, type GridCell, type TrendMetric } from "@/db/queries/trends";
import { shortDate, usd } from "@/lib/format";
import { hrefWith, param, resolveProfile, type SearchParams } from "@/lib/view";

/** /trends (PRD §18.2): any metric over any window, sector heatmap, stage velocity, mandate vs ecosystem, silence tracker, pattern history. */

export const metadata = { title: "Trends · Startup Funding Pulse" };

const METRICS: { key: TrendMetric; label: string }[] = [
  { key: "n", label: "Deal count" },
  { key: "capital", label: "Capital" },
  { key: "median", label: "Median cheque" },
];
const SPANS = [8, 12, 26] as const;

function value(c: GridCell | undefined, m: TrendMetric): number | null {
  if (!c) return m === "median" ? null : 0;
  return m === "n" ? c.n : m === "capital" ? c.capital : c.median;
}
function fmt(v: number | null, m: TrendMetric): string {
  if (v === null || v === 0) return "";
  return m === "n" ? String(v) : usd(v, { undisclosed: "" }).replace("$", "");
}

async function Content({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const { all, active } = await resolveProfile(param(sp, "profile"));
  if (!active) return <p className="text-sm">Unknown profile.</p>;
  const metric = (METRICS.find((m) => m.key === param(sp, "metric"))?.key ?? "n") as TrendMetric;
  const span = SPANS.find((s) => String(s) === param(sp, "weeks")) ?? 12;
  const current = weekOf(new Date());
  const weeks = Array.from({ length: span }, (_, i) => addWeeks(current, i - span + 1));
  const [grid, velocity, lastBySector, patterns] = await Promise.all([
    getSectorWeekGrid(weeks[0] ?? current, current),
    getStageVelocity(),
    getLastDealBySector(),
    getPatternHistory(active.id),
  ]);
  const core = active.config.sectors_core.map((s) => s.name);
  const coreSet = new Set(core);
  const cell = new Map(grid.map((c) => [`${c.sector}|${c.week}`, c]));
  const sectors = [...new Set(grid.map((g) => g.sector))]
    .map((s) => ({ s, total: grid.filter((g) => g.sector === s).reduce((a, g) => a + (metric === "capital" ? g.capital : g.n), 0) }))
    .sort((a, b) => Number(coreSet.has(b.s)) - Number(coreSet.has(a.s)) || b.total - a.total)
    .map((x) => x.s);
  const maxCell = Math.max(1, ...grid.map((g) => value(g, metric) ?? 0));

  // Mandate vs ecosystem: weekly totals for core sectors against everything.
  const lines = weeks.map((w) => {
    const wk = grid.filter((g) => g.week === w);
    const sum = (xs: GridCell[]) => xs.reduce((a, g) => a + (metric === "capital" ? g.capital : g.n), 0);
    return { label: w.slice(5) + (w === current ? "*" : ""), ecosystem: sum(wk), mandate: sum(wk.filter((g) => coreSet.has(g.sector))) };
  });

  return (
    <>
      <div className="space-y-2">
        <ProfileSwitcher path="/trends" sp={sp} profiles={all} active={active} />
        <div className="flex flex-wrap gap-3">
          <Pills label="Metric" items={METRICS.map((m) => ({ href: hrefWith("/trends", sp, { metric: m.key }), label: m.label, active: m.key === metric }))} />
          <Pills label="Weeks" items={SPANS.map((s) => ({ href: hrefWith("/trends", sp, { weeks: String(s) }), label: `${s} weeks`, active: s === span }))} />
        </div>
      </div>

      <Card title={`Sector × week heatmap — ${METRICS.find((m) => m.key === metric)?.label}`} n={grid.reduce((a, g) => a + g.n, 0)} note="Darker = more. Core mandate sectors listed first (bold). * current week is partial. Capital and medians use disclosed amounts only.">
        {sectors.length === 0 ? (
          <Empty>No deals in this span.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0.5 text-xs" style={{ minWidth: 120 + weeks.length * 44 }}>
              <thead>
                <tr>
                  <th className="sticky left-0 bg-card px-1 text-left font-medium text-muted">Sector</th>
                  {weeks.map((w) => (
                    <th key={w} className="px-1 font-medium text-muted">
                      {w.slice(5)}
                      {w === current ? "*" : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sectors.map((s) => (
                  <tr key={s}>
                    <td className={`sticky left-0 bg-card px-1 py-0.5 ${coreSet.has(s) ? "font-semibold" : ""}`}>
                      <Link className="transition-colors hover:text-accent" href={`/sectors/${encodeURIComponent(s)}?profile=${active.id}`}>
                        {s}
                      </Link>
                    </td>
                    {weeks.map((w) => {
                      const c = cell.get(`${s}|${w}`);
                      const v = value(c, metric);
                      const a = v === null ? 0 : Math.sqrt(v / maxCell);
                      return (
                        <td
                          key={w}
                          title={`${s}, ${w}: ${c?.n ?? 0} deals, ${usd(c?.capital ?? 0, { undisclosed: "$0" })}${c?.median ? `, median ${usd(c.median)}` : ""}`}
                          className="h-7 rounded-md text-center font-semibold tabular-nums transition-transform duration-150 hover:scale-110"
                          style={{ background: a ? `color-mix(in srgb, ${a > 0.6 ? "var(--chart-4)" : "var(--chart-1)"} ${Math.round(18 + a * 72)}%, var(--card))` : "var(--card-2)", color: a > 0.5 ? "white" : undefined }}
                        >
                          {fmt(v, metric)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Mandate sectors vs the ecosystem" n={lines.reduce((a, l) => a + l.ecosystem, 0)} note={`Core sectors: ${core.join(", ")}.`}>
          <WeekLines data={lines} series={[{ key: "ecosystem", label: "All sectors" }, { key: "mandate", label: "Core mandate sectors" }]} money={metric === "capital"} />
        </Card>
        <Card title="Silence tracker" n={core.length} note="Weeks since the last deal in each core sector. The sector-silence detector fires at 3+ weeks.">
          <ul className="space-y-2 text-sm">
            {core.map((s) => {
              const l = lastBySector.get(s);
              const gap = l?.week ? weeksBetween(l.week, current) : null;
              return (
                <li key={s} className="flex items-baseline justify-between gap-2">
                  <span>{s}</span>
                  <span className={`tabular-nums ${gap !== null && gap >= 3 ? "font-semibold text-down" : "text-muted"}`}>
                    {gap === null ? "no deals yet" : gap === 0 ? "deal this week" : `${gap} wk`} {l ? <span className="text-xs text-muted">(last {shortDate(l.last)})</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Stage velocity" n={velocity.reduce((a, v) => a + v.n, 0)} note="Median months between a company's previous round and this one, by sector, where the article states the prior round date (≥ 2 deals).">
          {velocity.length === 0 ? (
            <Empty>Too few deals report a prior round date.</Empty>
          ) : (
            <BarList rows={velocity.map((v) => ({ key: v.sector, label: v.sector, value: v.medianMonths, display: `${v.medianMonths.toFixed(1)} mo · n=${v.n}`, highlight: coreSet.has(v.sector) }))} />
          )}
        </Card>
        <Card className="lg:col-span-2" title="Pattern history" n={patterns.length} note={<>Every pattern that passed all three gates, newest first. “×N” = consecutive weeks it has fired. <Link className="link" href={`/methodology?profile=${active.id}`}>Detector gates</Link></>}>
          {patterns.length === 0 ? (
            <Empty>No patterns have fired yet.</Empty>
          ) : (
            <Table head={["Week", "Pattern", "Confidence", "n", "Streak"]} minWidth={560}>
              {patterns.map((p) => (
                <tr key={p.id}>
                  <td className={`${td} whitespace-nowrap text-xs`}>{p.week}</td>
                  <td className={td}>
                    <span className="font-medium">{p.title}</span>
                    <div className="text-xs text-muted">{p.statement}</div>
                  </td>
                  <td className={td}>
                    <Badge tone={p.confidence === "strong" ? "good" : p.confidence === "emerging" ? "accent" : "neutral"}>{p.confidence.replace("_", " ")}</Badge>
                  </td>
                  <td className={`${td} tabular-nums`}>{p.sampleSize}</td>
                  <td className={`${td} tabular-nums`}>×{p.consecutiveWeeks}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

export default function TrendsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Page eyebrow="Over time" title="Trends" subtitle="Where capital has moved over time, and what the statistically gated detectors have seen.">
      <Suspense fallback={<Loading what="trends" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}
