import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Badge, Card, Loading, Page, Table, td } from "@/components/ui";
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
  return (
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
  );
}

export default function SectorsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Page title="Sectors" subtitle="Trend, deals, investors, cheque evolution and a market map for every sector.">
      <Suspense fallback={<Loading what="sectors" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}
