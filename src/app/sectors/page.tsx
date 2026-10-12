import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { SectorTreemap } from "@/components/charts";
import { BarList } from "@/components/deals";
import { Badge, Card, Icon, Loading, Page, Table, td } from "@/components/ui";
import { listSectors } from "@/db/queries/sectors";
import { shortDate, usd } from "@/lib/format";
import { param, resolveProfile, type SearchParams } from "@/lib/view";

/** /sectors — index of sector pages. */

export const metadata = { title: "Sectors · Startup Funding Pulse" };

async function Content({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const [{ active }, rows] = await Promise.all([resolveProfile(param(sp, "profile")), listSectors()]);
  const core = new Set(active?.config.sectors_core.map((s) => s.name) ?? []);
  const watch = new Set(active?.config.sectors_watch ?? []);
  const q = active ? `?profile=${active.id}` : "";
  const maxCap = Math.max(1, ...rows.map((r) => r.capital));
  const recentMax = [...rows].sort((a, b) => b.recent - a.recent);
  return (
    <>
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2" icon={Icon.grid} title="All-time capital by sector" subtitle="Box size = disclosed capital in our data · colour = deals in the last 28 days" n={rows.reduce((a, r) => a + r.n, 0)} note="Greener boxes have more deals in the last four weeks. Outlined boxes are core sectors for the active profile. Click a box for the sector page.">
        <SectorTreemap
          data={rows.map((r) => ({ name: r.sector, size: r.capital > 0 ? r.capital : maxCap * 0.02, capital: r.capital, n: r.n, delta: r.recent >= 6 ? 3 : r.recent >= 2 ? 1 : 0, core: core.has(r.sector), href: `/sectors/${encodeURIComponent(r.sector)}${q}`, caption: `${usd(r.capital, { undisclosed: "$0" })} · ${r.recent} deals in 28 days` }))}
          height={340}
          fill
        />
      </Card>
      <Card icon={Icon.flame} title="Most active right now" subtitle="Deals in the last 28 days" n={rows.reduce((a, r) => a + r.recent, 0)}>
        <BarList spread rows={recentMax.slice(0, 10).map((r) => ({ key: r.sector, label: r.sector, href: `/sectors/${encodeURIComponent(r.sector)}${q}`, value: r.recent, display: `${r.recent} deals`, highlight: core.has(r.sector) }))} />
      </Card>
    </div>
    <Card title="All sectors" n={rows.reduce((a, r) => a + r.n, 0)} note={active ? `Mandate labels for ${active.displayName}.` : undefined}>
      <Table head={["Sector", "Deals (all)", "Last 28 days", "Capital (all)", "Latest deal", ""]} minWidth={640}>
        {rows.map((r) => (
          <tr key={r.sector}>
            <td className={td}>
              <Link className="link font-medium" href={`/sectors/${encodeURIComponent(r.sector)}${q}`}>
                {r.sector}
              </Link>
            </td>
            <td className={`${td} tabular-nums`}>{r.n}</td>
            <td className={`${td} tabular-nums`}>{r.recent}</td>
            <td className={`${td} tabular-nums`}>{usd(r.capital, { undisclosed: "$0" })}</td>
            <td className={td}>{shortDate(r.last)}</td>
            <td className={td}>{core.has(r.sector) ? <Badge tone="accent">core</Badge> : watch.has(r.sector) ? <Badge>watch</Badge> : null}</td>
          </tr>
        ))}
      </Table>
    </Card>
    </>
  );
}

export default function SectorsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Page eyebrow="Markets" title="Sectors" subtitle="Trend, deals, investors, cheque evolution and a market map for every sector.">
      <Suspense fallback={<Loading what="sectors" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}
