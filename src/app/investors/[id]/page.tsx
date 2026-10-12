import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { WeekLines } from "@/components/charts";
import { BarList, DealList } from "@/components/deals";
import { Badge, Card, Empty, Loading, Icon } from "@/components/ui";
import { getDb } from "@/db/client";
import { getDealsByIds } from "@/db/queries/deals";
import { getInvestorProfile } from "@/db/queries/investors";
import { shortDate, usd } from "@/lib/format";
import { param, resolveProfile, type SearchParams } from "@/lib/view";
import { sql } from "drizzle-orm";
import { z } from "zod";

/** Investor profile (PRD §18.3): deals, sector and stage mix, cheque, cadence, co-investors, overlap with your portfolio. */

export const metadata = { title: "Investor · Startup Funding Pulse" };

async function overlap(profileId: string, dealIds: string[]): Promise<{ dealId: string; company: string; portfolio: string; relationship: string }[]> {
  if (dealIds.length === 0) return [];
  const res = await getDb().execute(sql`
    SELECT ae.deal_id, co.canonical_name AS company, p.name AS portfolio, ae.relationship
    FROM adjacency_edges ae JOIN portfolio p ON p.id = ae.portfolio_id JOIN deals d ON d.id = ae.deal_id JOIN companies co ON co.id = d.company_id
    WHERE ae.profile_id = ${profileId} AND p.is_active AND ae.deal_id IN (${sql.join(dealIds.map((d) => sql`${d}`), sql`, `)})
    ORDER BY p.name`);
  return z.array(z.object({ deal_id: z.string(), company: z.string(), portfolio: z.string(), relationship: z.string() })).parse(res.rows).map((r) => ({ dealId: r.deal_id, company: r.company, portfolio: r.portfolio, relationship: r.relationship }));
}

async function Content({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,9}$/.test(id)) notFound();
  const { active } = await resolveProfile(param(sp, "profile"));
  const inv = await getInvestorProfile(Number(id));
  if (!inv) notFound();
  const [deals, ov] = await Promise.all([getDealsByIds(inv.dealIds.slice(0, 50), active?.id ?? null), active ? overlap(active.id, inv.dealIds) : Promise.resolve([])]);
  const core = new Set(active?.config.sectors_core.map((s) => s.name) ?? []);
  const q = active ? `?profile=${active.id}` : "";

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Deals", String(inv.totals.deals)],
          ["Rounds led", String(inv.totals.leadDeals)],
          ["Median round size", usd(inv.totals.medianCheque, { undisclosed: "—" })],
          ["Capital in rounds led", usd(inv.totals.capitalLed, { undisclosed: "—" })],
          ["First seen", shortDate(inv.firstDeal)],
        ].map(([k, v]) => (
          <div key={k} className="card card-hover p-4">
            <div className="text-xs text-muted">{k}</div>
            <div className="text-lg font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">
        Median round size is over {inv.totals.priced} priced rounds this investor joined (the investor&apos;s own cheque is rarely disclosed). &quot;First seen&quot; is the first deal in our
        data{inv.aliases.length ? `; also reported as ${inv.aliases.join(", ")}` : ""}.
      </p>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card icon={Icon.pie} subtitle="Deals by sector · gradient = your core sectors" title="Sector concentration" n={inv.totals.deals} note={active ? "Highlighted: core sectors of the active profile." : undefined}>
          <BarList rows={inv.sectors.map((s) => ({ key: s.sector, label: s.sector, href: `/sectors/${encodeURIComponent(s.sector)}${q}`, value: s.n, display: String(s.n), highlight: core.has(s.sector) }))} />
        </Card>
        <Card icon={Icon.layers} subtitle="Deals by round stage" title="Stage distribution" n={inv.totals.deals}>
          <BarList rows={inv.stages.map((s) => ({ key: s.stage, label: s.stage, value: s.n, display: String(s.n) }))} />
        </Card>
        <Card icon={Icon.users} subtitle="Investors most often on the same rounds" title="Top co-investors" n={inv.coInvestors.length}>
          {inv.coInvestors.length === 0 ? (
            <Empty>No co-investors recorded.</Empty>
          ) : (
            <BarList rows={inv.coInvestors.map((c) => ({ key: String(c.id), label: c.name, href: `/investors/${c.id}${q}`, value: c.together, display: `${c.together} round${c.together === 1 ? "" : "s"}` }))} />
          )}
        </Card>
      </div>

      <Card icon={Icon.chart} subtitle="Deals per ISO week in our data" title="Cadence over time" n={inv.cadence.reduce((s, c) => s + c.n, 0)} note="Deals per ISO week in our data.">
        <WeekLines data={inv.cadence.map((c) => ({ label: c.week.slice(5), deals: c.n }))} series={[{ key: "deals", label: "Deals" }]} height={180} />
      </Card>

      {active ? (
        <Card icon={Icon.bell} subtitle="Rounds adjacent to a tracked (simulated) portfolio company" title={`Overlap with ${active.displayName}'s tracked companies`} n={ov.length} note="Rounds this investor joined that are adjacent to a tracked (simulated) portfolio company.">
          {ov.length === 0 ? (
            <Empty>None of this investor&apos;s rounds are adjacent to a tracked company.</Empty>
          ) : (
            <ul className="space-y-1 text-sm">
              {ov.map((o) => (
                <li key={`${o.dealId}-${o.portfolio}`}>
                  <span className="font-medium">{o.company}</span> <Badge>{o.relationship.replace("_", " ")}</Badge> to tracked company {o.portfolio}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <Card icon={Icon.list} subtitle={inv.dealIds.length > 50 ? "50 most recent rounds" : "Every round this investor joined"} title="All deals" n={inv.dealIds.length} note={inv.dealIds.length > 50 ? "Showing the 50 most recent." : undefined}>
        <DealList deals={deals} showScore={!!active} />
      </Card>
      <p className="text-sm">
        <Link className="link" href={`/investors${q}`}>
          ← All investors
        </Link>
      </p>
    </>
  );
}

async function Title({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) return <>Investor</>;
  const res = await getDb().execute(sql`SELECT canonical_name AS name FROM investors WHERE id = ${Number(id)}`);
  return <>{(res.rows[0] as { name?: string } | undefined)?.name ?? "Investor"}</>;
}

export default function InvestorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        <Suspense fallback="Investor">
          <Title params={params} />
        </Suspense>
      </h1>
      <Suspense fallback={<Loading what="the investor profile" />}>
        <Content params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
