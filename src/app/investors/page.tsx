import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Badge, Card, Empty, Loading, Page, ProfileSwitcher, Table, td, WindowSelector } from "@/components/ui";
import { findWarmPath, getLeaderboard, getWatchedInvestors, getNewEntrants, layoutGraph, loadCoInvestGraph, topNetwork, type WarmPathResult } from "@/db/queries/investors";
import { SERIES } from "@/lib/chart-colors";
import { shortDate, usd } from "@/lib/format";
import { param, resolveProfile, resolveWindow, type SearchParams } from "@/lib/view";
import { toIsoDate } from "@/pipeline/normalize";

/** /investors (PRD §18.3): warm-path finder, leaderboard, new entrants, co-investment graph. */

export const metadata = { title: "Investors · Startup Funding Pulse" };

function WarmPath({ r, query, profileId }: { r: WarmPathResult; query: string; profileId: string }) {
  if (!r.target) return <p className="text-sm text-muted">No company matching “{query}” has a funding round in the database.</p>;
  const inv = (x: { id: number; name: string }, watched = false) => (
    <Link href={`/investors/${x.id}?profile=${profileId}`} className={`rounded-md border px-2 py-1 text-sm ${watched ? "border-accent font-medium text-accent" : "border-line"}`}>
      {x.name}
    </Link>
  );
  return (
    <div className="space-y-3 text-sm">
      <p>
        <strong>{r.target.company}</strong>: {r.startInvestors.some((s) => s.role === "lead") ? "lead investor(s)" : "no named lead; starting from all investors on its rounds"}:{" "}
        {r.startInvestors.map((s) => s.name).join(", ") || "none recorded"}.
      </p>
      {r.startInvestors.length === 0 ? (
        <p className="text-muted">No investors are recorded on this company&apos;s rounds, so there is no graph to traverse.</p>
      ) : r.watchedInvestors.length === 0 ? (
        <p className="text-muted">This profile has no watchlist investors yet. Add some in settings.</p>
      ) : r.direct ? (
        <p>
          {inv(r.direct, true)} already backs this company and is on your watchlist — the warmest path there is.
        </p>
      ) : r.path ? (
        <ol className="flex flex-wrap items-center gap-2">
          {r.path.map((h, i) => (
            <li key={`${h.from.id}-${h.to.id}`} className="flex flex-wrap items-center gap-2">
              {i === 0 ? inv(h.from) : null}
              <span className="text-xs text-muted">
                — co-invested in {h.deals.map((d) => d.company).join(", ")}
                {h.deals.length >= 5 ? "…" : ""} →
              </span>
              {inv(h.to, i === (r.path?.length ?? 0) - 1)}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-muted">
          No co-investment path within 4 hops connects {r.target.company}&apos;s investors to your {r.watchedInvestors.length} watchlist investors in the current data.
        </p>
      )}
      <p className="text-xs text-muted">
        Path = shortest chain of investors who appeared on the same funding round, from the company&apos;s lead to an investor on your watchlist (
        {r.watchedInvestors.map((w) => w.name).join(", ")}
        {r.unmatchedWatchlist.length ? `; not yet seen in any deal: ${r.unmatchedWatchlist.join(", ")}` : ""}). Pure graph search over deals already in the database.
      </p>
    </div>
  );
}

async function Content({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const now = new Date();
  const { all, active } = await resolveProfile(param(sp, "profile"));
  if (!active) return <p className="text-sm">Unknown profile.</p>;
  const win = resolveWindow(param(sp, "window") ?? "90d", active, now);
  const target = param(sp, "target");
  const since = toIsoDate(new Date(now.getTime() - 28 * 86_400_000));
  const [leaders, entrants, graph, warm] = await Promise.all([
    getLeaderboard(win.start, win.end, 25),
    getNewEntrants(since),
    loadCoInvestGraph(),
    target ? findWarmPath(active.id, target) : Promise.resolve(null),
  ]);
  const net = topNetwork(graph, 32, 1);
  const size = 640;
  const pos = layoutGraph(net.nodes, net.edges, size);
  const watchedIds = new Set((warm?.watchedInvestors ?? (await getWatchedInvestors(active.id)).watched).map((w) => w.id));

  return (
    <>
      <div className="space-y-2">
        <ProfileSwitcher path="/investors" sp={sp} profiles={all} active={active} />
      </div>

      <Card title="Warm-path finder" note="Who on your watchlist can introduce you to a company's lead investor?">
        <form method="get" action="/investors" className="no-print mb-3 flex gap-2">
          <input type="hidden" name="profile" value={active.id} />
          <input
            name="target"
            defaultValue={target ?? ""}
            placeholder="Target company, e.g. Kinetic Age"
            aria-label="Target company"
            className="input max-w-md"
          />
          <button type="submit" className="btn btn-primary">
            Find path
          </button>
        </form>
        {warm && target ? <WarmPath r={warm} query={target} profileId={active.id} /> : <p className="text-sm text-muted">Enter a company that has raised a round to see the shortest introduction chain.</p>}
      </Card>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Leaderboard" n={leaders.length} note={`${win.label}: ${win.start} → ${win.end}. Ranked by deals, then rounds led.`}>
          <div className="mb-2">
            <WindowSelector path="/investors" sp={sp} win={win} />
          </div>
          {leaders.length === 0 ? (
            <Empty>No investor activity in this window.</Empty>
          ) : (
            <Table head={["#", "Investor", "Deals", "Led", "Capital led", "Sectors"]} minWidth={560}>
              {leaders.map((l, i) => (
                <tr key={l.id}>
                  <td className={`${td} text-muted`}>{i + 1}</td>
                  <td className={td}>
                    <Link className="link" href={`/investors/${l.id}?profile=${active.id}`}>
                      {l.name}
                    </Link>{" "}
                    {watchedIds.has(l.id) ? <Badge tone="accent">watchlist</Badge> : null}
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
        <Card className="lg:col-span-2" title="New-entrant log" n={entrants.length} note={`Investors whose first deal in our data is on or after ${since}. Our history starts ${entrants[0]?.historyStart ?? "—"}, so "new" means new to this dataset, not necessarily new to India.`}>
          {entrants.length === 0 ? (
            <Empty>No new investors in the last 4 weeks.</Empty>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {entrants.map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-2 py-1.5">
                  <Link className="link" href={`/investors/${e.id}?profile=${active.id}`}>
                    {e.name}
                  </Link>
                  <span className="text-right text-xs text-muted">
                    first seen {shortDate(e.firstDeal)} · {e.deals} deal{e.deals === 1 ? "" : "s"} · {e.sectors.join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Co-investment graph" n={net.nodes.length} note={`The ${net.nodes.length} best-connected investors; ranked by number of distinct co-investors; a line joins two investors who backed the same round (thicker = more shared rounds). Watchlist investors are highlighted. All-time data.`}>
        {net.nodes.length < 2 ? (
          <Empty>Not enough repeat co-investment yet to draw a network.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-auto w-full max-w-3xl" role="img" aria-label="Co-investment network">
              {net.edges.map((e) => {
                const a = pos.get(e.a);
                const b = pos.get(e.b);
                if (!a || !b) return null;
                return <line key={`${e.a}-${e.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--chart-7)" strokeOpacity={0.25 + Math.min(0.5, e.w / 6)} strokeWidth={Math.min(5, e.w * 1.2)} strokeLinecap="round" />;
              })}
              {net.nodes.map((n) => {
                const p = pos.get(n.id);
                if (!p) return null;
                const watched = watchedIds.has(n.id);
                return (
                  <a key={n.id} href={`/investors/${n.id}?profile=${active.id}`}>
                    {watched ? <circle cx={p.x} cy={p.y} r={8 + Math.min(8, n.degree)} fill="none" stroke="var(--chart-4)" strokeWidth="2.5" strokeDasharray="3 2" /> : null}
                    <circle cx={p.x} cy={p.y} r={4 + Math.min(8, n.degree)} fill={watched ? "var(--chart-4)" : SERIES[n.degree % 5]} fillOpacity={0.9} stroke="var(--card)" strokeWidth="1.5" />
                    <text x={p.x} y={p.y - 8 - Math.min(8, n.degree)} textAnchor="middle" fontSize="10" fill="var(--foreground)">
                      {n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name}
                    </text>
                  </a>
                );
              })}
            </svg>
          </div>
        )}
      </Card>
    </>
  );
}

export default function InvestorsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Page eyebrow="Capital sources" title="Investors" subtitle="Who is writing cheques, who they write them with, and how to reach them.">
      <Suspense fallback={<Loading what="investor data" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}
