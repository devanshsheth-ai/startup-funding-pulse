import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { WeekLines } from "@/components/charts";
import { BarList, DealList } from "@/components/deals";
import { DeepDivePanel } from "@/components/deep-dive";
import { Badge, Card, Empty, Loading, ProfileSwitcher, Table, td } from "@/components/ui";
import { queryDeals } from "@/db/queries/deals";
import { getMarketMap, getSectorSummary } from "@/db/queries/sectors";
import { dealFiltersSchema } from "@/lib/deal-filters";
import { delta, shortDate, usd } from "@/lib/format";
import { SECTORS } from "@/lib/taxonomy";
import { param, resolveProfile, type SearchParams } from "@/lib/view";
import { toIsoDate } from "@/pipeline/normalize";
import { DEEP_DIVE_DAYS } from "@/pipeline/deep-dive";

/** /sectors/[sector] (PRD §18.6): trend, deals, investors, cheque evolution, market map, exits, deep-dive. */

export const metadata = { title: "Sector · Startup Funding Pulse" };

async function Content({ params, searchParams }: { params: Promise<{ sector: string }>; searchParams: SearchParams }) {
  await connection();
  const sector = decodeURIComponent((await params).sector);
  if (!SECTORS.includes(sector)) notFound();
  const sp = await searchParams;
  const now = new Date();
  const { all, active } = await resolveProfile(param(sp, "profile"));
  const end = toIsoDate(now);
  const start = toIsoDate(new Date(now.getTime() - (DEEP_DIVE_DAYS - 1) * 86_400_000));
  const [s, map, deals] = await Promise.all([
    getSectorSummary(sector, start, end),
    getMarketMap(sector, active?.id ?? null),
    queryDeals(dealFiltersSchema.parse({ profile: active?.id, sector: [sector], from: start, to: end, sort: "date", limit: 40 })),
  ]);
  const isCore = active?.config.sectors_core.some((c) => c.name === sector) ?? false;
  const q = active ? `?profile=${active.id}` : "";

  return (
    <>
      {active ? <ProfileSwitcher path={`/sectors/${encodeURIComponent(sector)}`} sp={sp} profiles={all} active={active} /> : null}
      <p className="text-sm text-muted">
        Last {DEEP_DIVE_DAYS} days ({start} → {end}): <strong className="text-foreground">{s.totals.n}</strong> deals, <strong className="text-foreground">{usd(s.totals.capital, { undisclosed: "$0" })}</strong> disclosed,
        median {usd(s.totals.median, { undisclosed: "n/a" })} (n = {s.totals.priced} priced). {s.totals.allTimeN} deals in this sector in all our data.{" "}
        {isCore ? <Badge tone="accent">core sector for {active?.displayName}</Badge> : null}
      </p>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Trend over time" n={s.weekly.reduce((a, w) => a + w.n, 0)} note="Deals per ISO week (left) and disclosed capital (right chart).">
          <WeekLines data={s.weekly.map((w) => ({ label: w.week.slice(5), deals: w.n }))} series={[{ key: "deals", label: "Deals" }]} height={180} />
          <WeekLines data={s.weekly.map((w) => ({ label: w.week.slice(5), capital: w.capital }))} series={[{ key: "capital", label: "Capital" }]} money height={160} />
        </Card>
        <Card title="Active investors" n={s.investors.length} note={`Window: last ${DEEP_DIVE_DAYS} days. Bar = deals; label shows rounds led.`}>
          {s.investors.length === 0 ? (
            <Empty>No named investors in this window.</Empty>
          ) : (
            <BarList rows={s.investors.map((i) => ({ key: String(i.id), label: i.name, href: `/investors/${i.id}${q}`, value: i.deals, display: `${i.deals} · led ${i.lead}` }))} />
          )}
        </Card>
      </div>

      <Card title="Market map" n={map.reduce((a, c) => a + c.companies.length, 0)} note={map[0] ? `Clusters pre-computed nightly from company description embeddings (k-means), labelled by Gemini; last computed ${map[0].computedAt.slice(0, 16)} UTC. Tracked companies are placed in their nearest cluster.` : "Computed nightly once a sector has at least 6 companies with embeddings."}>
        {map.length === 0 ? (
          <Empty>No market map for this sector yet.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {map.map((c) => (
              <div key={c.id} className={`rounded-md border p-3 ${c.tracked.length ? "border-accent" : "border-line"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-medium">{c.label}</h3>
                  <span className="text-xs tabular-nums text-muted">
                    {c.dealCount} deals · {usd(c.capital, { undisclosed: "$0" })}
                  </span>
                </div>
                {c.tracked.length ? (
                  <p className="mt-1 flex flex-wrap gap-1">
                    {c.tracked.map((t) => (
                      <Badge key={t} tone="accent">
                        ★ tracked: {t}
                      </Badge>
                    ))}
                  </p>
                ) : null}
                <p className="mt-2 text-sm">{c.companies.map((x) => x.name).join(" · ")}</p>
                {c.topInvestors.length ? <p className="mt-1 text-xs text-muted">Top investors: {c.topInvestors.join(", ")}</p> : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Cheque evolution by stage" n={s.chequeByStage.reduce((a, c) => a + c.n, 0)} note={`Median round size in the last ${DEEP_DIVE_DAYS} days vs the ${DEEP_DIVE_DAYS} days before. Priced rounds only; small n is shown, not hidden.`}>
          {s.chequeByStage.length === 0 ? (
            <Empty>No priced rounds in this window.</Empty>
          ) : (
            <Table head={["Stage", "Median", "p25–p75", "n", "Prior median", "Change"]} minWidth={520}>
              {s.chequeByStage.map((c) => {
                const d = c.median !== null && c.earlierMedian !== null ? delta(c.median, c.earlierMedian) : null;
                return (
                  <tr key={c.stage}>
                    <td className={td}>{c.stage}</td>
                    <td className={`${td} tabular-nums`}>{usd(c.median)}</td>
                    <td className={`${td} tabular-nums text-xs text-muted`}>
                      {usd(c.p25)}–{usd(c.p75)}
                    </td>
                    <td className={`${td} tabular-nums`}>{c.n}</td>
                    <td className={`${td} tabular-nums`}>
                      {usd(c.earlierMedian, { undisclosed: "—" })} <span className="text-xs text-muted">n={c.earlierN}</span>
                    </td>
                    <td className={`${td} tabular-nums text-xs`}>{d ? d.text : "—"}</td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
        <Card title="Sub-sectors" n={s.subSectors.reduce((a, x) => a + x.n, 0)}>
          {s.subSectors.length === 0 ? <Empty>No deals in this window.</Empty> : <BarList rows={s.subSectors.map((x) => ({ key: x.sub, label: x.sub, value: x.n, display: `${x.n} · ${usd(x.capital, { undisclosed: "$0" })}` }))} />}
        </Card>
      </div>

      <Card title="Exits and shutdowns" n={s.exits.length}>
        {s.exits.length === 0 ? (
          <Empty>No M&A, IPO filings or shutdowns recorded in this sector.</Empty>
        ) : (
          <ul className="space-y-1 text-sm">
            {s.exits.map((e) => (
              <li key={e.id}>
                <span className="text-xs text-muted">{shortDate(e.date)}</span> <Badge>{e.type.replace("_", " ")}</Badge> {e.headline}{" "}
                {e.url ? (
                  <a className="link text-xs" href={e.url} target="_blank" rel="noopener noreferrer">
                    ↗
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {active ? (
        <Card title="Deep-dive" className="print-break" note="Generated on demand from the statistics on this page; exportable as PDF via your browser's print dialog.">
          <DeepDivePanel sector={sector} profileId={active.id} />
        </Card>
      ) : null}

      <Card title={`All deals, last ${DEEP_DIVE_DAYS} days`} n={deals.total} note={<Link className="link" href={`/explorer?sector=${encodeURIComponent(sector)}${active ? `&profile=${active.id}` : ""}`}>Open in explorer (filters, CSV) →</Link>}>
        {deals.rows.length === 0 ? <Empty>No deals in this window.</Empty> : <DealList deals={deals.rows} showScore={!!active} />}
      </Card>
    </>
  );
}

async function Title({ params }: { params: Promise<{ sector: string }> }) {
  return <>{decodeURIComponent((await params).sector)}</>;
}

export default function SectorPage({ params, searchParams }: { params: Promise<{ sector: string }>; searchParams: SearchParams }) {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6">
      <div>
        <Link className="link text-xs text-muted" href="/sectors">
          ← Sectors
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          <Suspense fallback="Sector">
            <Title params={params} />
          </Suspense>
        </h1>
      </div>
      <Suspense fallback={<Loading what="the sector" />}>
        <Content params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
