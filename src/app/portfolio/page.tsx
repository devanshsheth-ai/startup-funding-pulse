import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Badge, Card, Disclosure, Empty, Loading, Page, ProfileSwitcher, Table, td } from "@/components/ui";
import { getAggregates } from "@/db/queries/aggregates";
import { getAdjacencyTimeline, getRelatedEvents, getTracked, getWatchlist, pressureScore } from "@/db/queries/portfolio";
import { RELATIONSHIP_LABELS, STAGE_HELD_LABEL } from "@/lib/copy";
import { RELATIONSHIP_TEXT, shortDate, usd } from "@/lib/format";
import { param, resolveProfile, type SearchParams } from "@/lib/view";
import { toIsoDate } from "@/pipeline/normalize";

/**
 * /portfolio (PRD §18.4). The simulated-portfolio disclosure is rendered as a
 * non-dismissible banner (no close control, not in a client component) and
 * the stage label is always "Assumed stage held" (PRD §8.2).
 */

export const metadata = { title: "Portfolio · Startup Funding Pulse" };

async function Content({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const now = new Date();
  const { all, active } = await resolveProfile(param(sp, "profile"));
  if (!active) return <p className="text-sm">Unknown profile.</p>;
  const momentumWin = { start: toIsoDate(new Date(now.getTime() - 27 * 86_400_000)), end: toIsoDate(now) };
  const [tracked, timeline, watch, agg] = await Promise.all([getTracked(active.id), getAdjacencyTimeline(active.id), getWatchlist(active.id), getAggregates(momentumWin)]);
  const events = await getRelatedEvents(tracked.map((t) => t.name));
  const sectorRow = new Map(agg.sectors.rows.map((s) => [s.sector, s]));

  return (
    <>
      <ProfileSwitcher path="/portfolio" sp={sp} profiles={all} active={active} />

      {tracked.length === 0 ? (
        <Card>
          <Empty>
            No tracked companies for this profile. Add some in{" "}
            <Link className="link" href={`/settings?profile=${active.id}`}>
              settings
            </Link>
            .
          </Empty>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {tracked.map((t) => {
          const edges = timeline.filter((e) => e.portfolioId === t.id);
          const p = pressureScore(edges, now);
          const m = sectorRow.get(t.sector);
          const ev = events.get(t.name) ?? [];
          return (
            <Card key={t.id} title={t.name}>
              <div className="-mt-2 mb-3 space-y-1 text-sm">
                <p className="flex flex-wrap gap-1">
                  <Badge>{RELATIONSHIP_LABELS[t.relationshipType] ?? t.relationshipType}</Badge>
                  <Badge>
                    {STAGE_HELD_LABEL}: {t.stageHeld ?? "—"}
                  </Badge>
                  <Badge>
                    {t.sector}
                    {t.subSector ? ` · ${t.subSector}` : ""}
                  </Badge>
                  {t.city ? <Badge>{t.city}</Badge> : null}
                </p>
                <p className="text-muted">{t.description}</p>
              </div>
              <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md border border-line p-2">
                  <div className="text-lg font-semibold tabular-nums">{p.score.toFixed(2)}</div>
                  <div className="text-[11px] text-muted" title="Σ weight × confidence × e^(−age/30d); competitor = 1, same layer = 0.6">
                    competitive pressure
                  </div>
                </div>
                <div className="rounded-md border border-line p-2">
                  <div className="text-lg font-semibold tabular-nums">
                    {p.competitors} / {p.sameLayer}
                  </div>
                  <div className="text-[11px] text-muted">competitor / same-layer raises ({p.last30} in 30 days)</div>
                </div>
                <div className="rounded-md border border-line p-2">
                  <div className="text-lg font-semibold tabular-nums">{m ? `${m.z >= 0 ? "+" : ""}${m.z.toFixed(1)}σ` : "—"}</div>
                  <div className="text-[11px] text-muted">
                    {t.sector} momentum, 28 days (n = {m?.n ?? 0})
                  </div>
                </div>
              </div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Adjacency timeline</h3>
              {edges.length === 0 ? (
                <p className="text-sm text-muted">No adjacent raises detected yet.</p>
              ) : (
                <ol className="relative space-y-2 border-l border-line pl-4 text-sm">
                  {edges.slice(0, 8).map((e) => (
                    <li key={e.dealId} className="relative">
                      <span className="absolute -left-[21px] top-0 mt-1.5 h-2.5 w-2.5 rounded-full bg-accent" />
                      <span className="text-xs text-muted">{shortDate(e.announced)}</span>{" "}
                      <Badge tone={e.relationship === "competitor" ? "bad" : e.relationship === "same_layer" ? "warn" : "neutral"}>{RELATIONSHIP_TEXT[e.relationship] ?? e.relationship}</Badge>{" "}
                      <span className="font-medium">{e.company}</span>{" "}
                      <span className="text-muted">
                        {e.stage} · {usd(e.amountUsd)} · conf. {e.confidence.toFixed(2)}
                      </span>
                      <div className="text-xs text-muted">{e.rationale}</div>
                      {e.sourceUrl ? (
                        <a className="link text-xs" href={e.sourceUrl} target="_blank" rel="noopener noreferrer">
                          {e.publication ?? "source"} ↗
                        </a>
                      ) : null}
                    </li>
                  ))}
                  {edges.length > 8 ? <li className="text-xs text-muted">+{edges.length - 8} earlier</li> : null}
                </ol>
              )}
              <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Related events (180 days)</h3>
              {ev.length === 0 ? (
                <p className="text-sm text-muted">None reported.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {ev.slice(0, 5).map((e) => (
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
              <p className="mt-3 text-[11px] text-muted">Adjacency keywords: {t.keywords.join(" · ")}</p>
            </Card>
          );
        })}
      </div>

      <Card title="Watchlist" n={watch.length} note={<>Companies and funds being monitored; no relationship implied. Manage in <Link className="link" href={`/settings?profile=${active.id}#watchlist`}>settings</Link>.</>}>
        {watch.length === 0 ? (
          <Empty>The watchlist is empty.</Empty>
        ) : (
          <Table head={["Type", "Watching", "Status", "Last event", "Alerts", "Notes"]} minWidth={720}>
            {watch.map((w) => (
              <tr key={w.id}>
                <td className={`${td} text-xs text-muted`}>{w.type}</td>
                <td className={td}>
                  {w.value}
                  {w.tags.length ? <span className="ml-1 text-xs text-muted">{w.tags.map((t) => `#${t}`).join(" ")}</span> : null}
                </td>
                <td className={td}>
                  <Badge>{w.status}</Badge>
                </td>
                <td className={`${td} text-xs`}>
                  {w.lastEvent ? shortDate(w.lastEvent) : "—"}
                  {w.lastEventLabel ? <span className="text-muted"> · {w.lastEventLabel}</span> : null}
                </td>
                <td className={`${td} text-xs`}>{w.alertsEnabled ? "on" : "off"}</td>
                <td className={`${td} text-xs text-muted`}>{w.notes ?? ""}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

export default function PortfolioPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Page title="Portfolio" subtitle="Tracked companies, the raises adjacent to them, and the watchlist.">
      <Disclosure />
      <Suspense fallback={<Loading what="tracked companies" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}
