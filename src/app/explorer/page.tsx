import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { DealList, InvestorLinks, Provenance, SourceLinks } from "@/components/deals";
import { Badge, Card, Empty, Loading, Page, Pills, Table, td, Icon } from "@/components/ui";
import { queryDeals, queryEvents } from "@/db/queries/deals";
import { filtersToParams, parseDealFilters, parseEventFilters, TIERS, type DealFilters } from "@/lib/deal-filters";
import { shortDate, TIER_LABELS, usd } from "@/lib/format";
import { ALL_STAGES, EVENT_TYPES, SECTORS } from "@/lib/taxonomy";
import { hrefWith, param, resolveProfile, type SearchParams } from "@/lib/view";
import { translateQuery } from "@/pipeline/nl-search";

/** /explorer (PRD §18.5): the full deal and event archive with filters, CSV export and natural-language search. */

export const metadata = { title: "Explorer · Startup Funding Pulse" };
// Natural-language translation is one Gemini call (cached by content hash).
export const maxDuration = 60;

const input = "input";

function Multi({ name, label, options, selected, render }: { name: string; label: string; options: readonly string[]; selected: string[]; render?: (o: string) => string }) {
  return (
    <details className="relative">
      <summary className="btn btn-secondary btn-sm list-none">
        {label}
        {selected.length ? ` (${selected.length})` : ""} ▾
      </summary>
      <div className="absolute z-10 mt-1 max-h-72 w-64 overflow-y-auto rounded-2xl border border-line bg-card p-2 shadow-xl">
        {options.map((o) => (
          <label key={o} className="flex items-center gap-2 py-0.5 text-sm">
            <input type="checkbox" name={name} value={o} defaultChecked={selected.includes(o)} />
            {render ? render(o) : o}
          </label>
        ))}
      </div>
    </details>
  );
}

function FilterForm({ f, view }: { f: DealFilters; view: string }) {
  return (
    <form method="get" action="/explorer" className="no-print space-y-2">
      {f.profile ? <input type="hidden" name="profile" value={f.profile} /> : null}
      <input type="hidden" name="view" value={view} />
      <div className="flex flex-wrap gap-2">
        <Multi name="sector" label="Sector" options={SECTORS} selected={f.sector} />
        <Multi name="stage" label="Stage" options={ALL_STAGES} selected={f.stage} />
        <Multi name="tier" label="Tier" options={TIERS} selected={f.tier} render={(t) => TIER_LABELS[t] ?? t} />
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="verified" value="1" defaultChecked={f.verified} /> Verified only
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <input className={input} name="company" placeholder="Company / keyword" defaultValue={f.company ?? ""} aria-label="Company or keyword" />
        <input className={input} name="investor" placeholder="Investor" defaultValue={f.investor ?? ""} aria-label="Investor" />
        <input className={input} name="city" placeholder="City" defaultValue={f.city ?? ""} aria-label="City" />
        <input className={input} type="date" name="from" defaultValue={f.from ?? ""} aria-label="From date" />
        <input className={input} type="date" name="to" defaultValue={f.to ?? ""} aria-label="To date" />
        <input className={input} type="number" min={0} step="any" name="min_amount" placeholder="Min $" defaultValue={f.min_amount ?? ""} aria-label="Minimum amount USD" />
        <input className={input} type="number" min={0} step="any" name="max_amount" placeholder="Max $" defaultValue={f.max_amount ?? ""} aria-label="Maximum amount USD" />
        <select className={input} name="sort" defaultValue={f.sort} aria-label="Sort by">
          <option value="date">Newest first</option>
          <option value="amount">Largest first</option>
          <option value="score">Highest score</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button className="btn btn-primary btn-sm" type="submit">
          Apply filters
        </button>
        <Link className="btn btn-secondary btn-sm" href={f.profile ? `/explorer?profile=${f.profile}` : "/explorer"}>
          Reset
        </Link>
      </div>
    </form>
  );
}

function Chips({ f }: { f: DealFilters }) {
  const chips: string[] = [
    ...f.sector.map((s) => `sector: ${s}`),
    ...f.stage.map((s) => `stage: ${s}`),
    ...f.tier.map((t) => `tier: ${t}`),
    ...(f.investor ? [`investor: ${f.investor}`] : []),
    ...(f.city ? [`city: ${f.city}`] : []),
    ...(f.company ? [`company/keyword: ${f.company}`] : []),
    ...(f.from ? [`from ${f.from}`] : []),
    ...(f.to ? [`to ${f.to}`] : []),
    ...(f.min_amount !== undefined ? [`≥ ${usd(f.min_amount)}`] : []),
    ...(f.max_amount !== undefined ? [`≤ ${usd(f.max_amount)}`] : []),
    ...(f.verified ? ["verified only"] : []),
    `sort: ${f.sort}`,
  ];
  return (
    <span className="inline-flex flex-wrap gap-1">
      {chips.map((c) => (
        <Badge key={c} tone="accent">
          {c}
        </Badge>
      ))}
    </span>
  );
}

async function Deals({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const { all, active } = await resolveProfile(param(sp, "profile"));
  let f = parseDealFilters(sp);
  f = { ...f, profile: active?.id };
  const nl = param(sp, "nl");
  const view = param(sp, "view") === "cards" ? "cards" : "table";
  let nlNote: ReactNode = null;
  if (nl) {
    const r = await translateQuery(nl, { profile: active?.id });
    if (r.filters) {
      f = { ...r.filters, profile: active?.id };
      const href = `/explorer?${filtersToParams(f).toString()}`;
      nlNote = (
        <div className="card animate-in space-y-1 p-4 text-sm">
          <p>
            “{nl}” was interpreted as <Chips f={f} />{" "}
            <Link className="link text-xs" href={href}>
              edit these filters
            </Link>
          </p>
          {r.unsupported.length ? <p className="text-xs text-amber-700 dark:text-amber-300">Not expressible as a filter, so ignored: {r.unsupported.join("; ")}.</p> : null}
          <p className="text-xs text-muted">Gemini only produced a filter object from a fixed list of fields; it was validated before the query ran. No model-written SQL.</p>
        </div>
      );
    } else nlNote = <p className="card p-4 text-sm text-down">{r.error ?? "No filters could be derived from that question."}</p>;
  }
  const res = await queryDeals(f);
  const base = filtersToParams({ ...f, cursor: 0, limit: f.limit });
  const csv = `/api/export/deals.csv?${base.toString()}`;
  const page = (cursor: number | null) => (cursor === null ? null : `/explorer?${filtersToParams({ ...f, cursor }).toString()}&view=${view}`);
  const prevCursor = f.cursor > 0 ? Math.max(0, f.cursor - f.limit) : null;

  return (
    <>
      <form method="get" action="/explorer" className="no-print flex gap-2">
        {active ? <input type="hidden" name="profile" value={active.id} /> : null}
        <input className={`${input} py-2`} name="nl" defaultValue={nl ?? ""} placeholder="Ask in plain English, e.g. “fintech seed rounds in Bengaluru over $2M since August, biggest first”" aria-label="Natural-language search" />
        <button className="btn btn-primary" type="submit">
          Search
        </button>
      </form>
      {nlNote}
      <FilterForm f={f} view={view} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Pills label="Profile" items={all.map((p) => ({ href: hrefWith("/explorer", sp, { profile: p.id, cursor: null }), label: p.displayName, active: p.id === active?.id }))} />
        </div>
        <div className="no-print flex items-center gap-2 text-sm">
          <Pills label="View" items={["table", "cards"].map((v) => ({ href: hrefWith("/explorer", sp, { view: v }), label: v === "table" ? "Table" : "Cards", active: v === view }))} />
          <a className="btn btn-secondary btn-sm" href={csv}>
            ⬇ CSV of this view
          </a>
        </div>
      </div>
      <Card icon={Icon.list} subtitle={`Showing ${res.total ? f.cursor + 1 : 0}–${f.cursor + res.rows.length} of ${res.total} · every row links to its sources`} title={`Deals${active ? ` · scored for ${active.displayName}` : ""}`} n={res.total} note={`Showing ${res.total ? f.cursor + 1 : 0}–${f.cursor + res.rows.length} of ${res.total}. Every row links to its sources.`}>
        {res.rows.length === 0 ? (
          <Empty>No deals match these filters.</Empty>
        ) : view === "cards" ? (
          <DealList deals={res.rows} />
        ) : (
          <Table head={["Date", "Company", "Stage", "Amount", "Sector", "City", "Lead", "Score", "Provenance", "Sources"]} minWidth={1100}>
            {res.rows.map((d) => (
              <tr key={d.id}>
                <td className={`${td} whitespace-nowrap`}>{shortDate(d.announced)}</td>
                <td className={td}>
                  <span className="font-medium">{d.company}</span>
                  {d.subSector ? <div className="text-xs text-muted">{d.subSector}</div> : null}
                </td>
                <td className={td}>{d.stage}</td>
                <td className={`${td} tabular-nums whitespace-nowrap`}>{usd(d.amountUsd)}</td>
                <td className={td}>
                  <Link className="link" href={`/sectors/${encodeURIComponent(d.sector)}${active ? `?profile=${active.id}` : ""}`}>
                    {d.sector}
                  </Link>
                </td>
                <td className={td}>{d.city ?? "—"}</td>
                <td className={`${td} text-xs`}>
                  <InvestorLinks list={d.leads} />
                </td>
                <td className={`${td} tabular-nums`} title={d.reason ?? undefined}>
                  {d.score === null ? "—" : Math.round(d.score)} {d.tier ? <span className="text-xs text-muted">{d.tier.replace("_", " ")}</span> : null}
                </td>
                <td className={td}>
                  <Provenance d={d} />
                </td>
                <td className={td}>
                  <SourceLinks sources={d.sources} max={2} />
                </td>
              </tr>
            ))}
          </Table>
        )}
        <div className="no-print mt-3 flex justify-between text-sm">
          {prevCursor !== null ? (
            <Link className="link" href={page(prevCursor) ?? "#"}>
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {res.nextCursor !== null ? (
            <Link className="link" href={page(res.nextCursor) ?? "#"}>
              Next →
            </Link>
          ) : null}
        </div>
      </Card>
    </>
  );
}

async function Events({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const f = parseEventFilters(sp);
  const res = await queryEvents(f);
  return (
    <>
      <form method="get" action="/explorer" className="no-print flex flex-wrap gap-2">
        <input type="hidden" name="tab" value="events" />
        <Multi name="type" label="Event type" options={EVENT_TYPES} selected={f.type} render={(t) => t.replace("_", " ")} />
        <Multi name="sector" label="Sector" options={SECTORS} selected={f.sector} />
        <input className={`${input} w-48`} name="q" placeholder="Search headlines" defaultValue={f.q ?? ""} aria-label="Search headlines" />
        <input className={`${input} w-40`} type="date" name="from" defaultValue={f.from ?? ""} aria-label="From date" />
        <input className={`${input} w-40`} type="date" name="to" defaultValue={f.to ?? ""} aria-label="To date" />
        <button className="btn btn-primary btn-sm" type="submit">
          Apply
        </button>
      </form>
      <Card icon={Icon.bell} subtitle="M&A, shutdowns, IPO filings, layoffs, people moves, fund closes and results" title="Events" n={res.total} note="M&A, shutdowns, IPO filings, layoffs, people moves, fund closes and financial results.">
        {res.rows.length === 0 ? (
          <Empty>No events match.</Empty>
        ) : (
          <Table head={["Date", "Type", "Headline", "Sector", "Amount", "Sources"]} minWidth={900}>
            {res.rows.map((e) => (
              <tr key={e.id}>
                <td className={`${td} whitespace-nowrap`}>{shortDate(e.date)}</td>
                <td className={td}>
                  <Badge>{e.type.replace("_", " ")}</Badge>
                </td>
                <td className={td}>
                  {e.headline}
                  {e.fundName ? <div className="text-xs text-muted">{e.fundName}</div> : null}
                </td>
                <td className={td}>{e.sector ?? "—"}</td>
                <td className={`${td} tabular-nums`}>{usd(e.fundSizeUsd ?? e.amountUsd, { undisclosed: "—" })}</td>
                <td className={td}>
                  <SourceLinks sources={e.sources} max={2} />
                </td>
              </tr>
            ))}
          </Table>
        )}
        <div className="no-print mt-3 flex justify-between text-sm">
          {f.cursor > 0 ? (
            <Link className="link" href={hrefWith("/explorer", sp, { cursor: String(Math.max(0, f.cursor - f.limit)) })}>
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {res.nextCursor !== null ? (
            <Link className="link" href={hrefWith("/explorer", sp, { cursor: String(res.nextCursor) })}>
              Next →
            </Link>
          ) : null}
        </div>
      </Card>
    </>
  );
}

async function Content({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const tab = param(sp, "tab") === "events" ? "events" : "deals";
  // Render errors fall through to app/error.tsx (no stack traces on public pages).
  return (
    <>
      <Pills
        label="Archive"
        items={[
          { href: hrefWith("/explorer", {}, { profile: param(sp, "profile") }), label: "Deals", active: tab === "deals" },
          { href: hrefWith("/explorer", {}, { tab: "events", profile: param(sp, "profile") }), label: "Events", active: tab === "events" },
        ]}
      />
      {tab === "events" ? <Events sp={sp} /> : <Deals sp={sp} />}
    </>
  );
}

export default function ExplorerPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Page eyebrow="Archive" title="Explorer" subtitle="Every deal and event in the database, filterable and exportable.">
      <Suspense fallback={<Loading what="the archive" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}
