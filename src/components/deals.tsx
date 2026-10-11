import Link from "next/link";
import type { ReactNode } from "react";
import { usd, shortDate, TIER_LABELS } from "@/lib/format";
import type { Scorecard } from "@/pipeline/rubric";
import { Badge } from "./ui";

/**
 * Deal rendering shared by dashboard, explorer, investor, sector and portfolio
 * pages. Every deal shows at least one clickable source (S4) and its
 * provenance (corroborated / single-source / disputed).
 */

export interface DealListItem {
  id: string;
  company: string;
  description: string | null;
  stage: string;
  amountUsd: number | null;
  amountRaw?: string | null;
  sector: string;
  subSector: string | null;
  city: string | null;
  announced: string;
  score: number | null;
  tier: string | null;
  reason: string | null;
  isVerified: boolean;
  corroboration: number;
  disputed: string[];
  leads: { id?: number; name: string }[] | string[];
  participants: { id?: number; name: string }[] | string[];
  sources: { publication: string | null; url: string; isPrimary?: boolean }[];
  breakdown: Scorecard | null;
  ingestionMode?: string;
}

const COMPONENT_LABELS: Record<string, string> = {
  sector_fit: "Sector fit",
  stage_fit: "Stage fit",
  cheque_fit: "Cheque fit",
  tracked_investor: "Tracked investor",
  geography_fit: "Geography fit",
  recency: "Recency",
  ecosystem_significance: "Ecosystem significance",
};

function names(xs: DealListItem["leads"]): { id?: number; name: string }[] {
  return (xs as ({ id?: number; name: string } | string)[]).map((x) => (typeof x === "string" ? { name: x } : x));
}

export function InvestorLinks({ list }: { list: DealListItem["leads"] }) {
  const xs = names(list);
  if (xs.length === 0) return <span className="text-muted">—</span>;
  return (
    <>
      {xs.map((x, i) => (
        <span key={x.name}>
          {i ? ", " : ""}
          {x.id ? (
            <Link className="link" href={`/investors/${x.id}`}>
              {x.name}
            </Link>
          ) : (
            x.name
          )}
        </span>
      ))}
    </>
  );
}

export function Provenance({ d }: { d: Pick<DealListItem, "isVerified" | "corroboration" | "disputed" | "ingestionMode"> }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {d.disputed.length ? (
        <Badge tone="bad" title={`Sources disagree on: ${d.disputed.join(", ")}`}>
          disputed: {d.disputed.join(", ")}
        </Badge>
      ) : d.isVerified ? (
        <Badge tone="good" title={`${d.corroboration} publications agree`}>
          ✓ {d.corroboration} sources
        </Badge>
      ) : (
        <Badge tone="warn" title="Reported by one publication only">
          single source
        </Badge>
      )}
      {d.ingestionMode && d.ingestionMode !== "live" ? <Badge title="How this record entered the database">{d.ingestionMode}</Badge> : null}
    </span>
  );
}

export function SourceLinks({ sources, max = 3 }: { sources: DealListItem["sources"]; max?: number }) {
  if (sources.length === 0) return <span className="text-muted">no source</span>;
  return (
    <span className="inline-flex flex-wrap gap-x-2">
      {sources.slice(0, max).map((s) => (
        <a key={s.url} className="link text-xs" href={s.url} target="_blank" rel="noopener noreferrer">
          {s.publication ?? "source"} ↗
        </a>
      ))}
      {sources.length > max ? <span className="text-xs text-muted">+{sources.length - max}</span> : null}
    </span>
  );
}

export function ScorecardView({ card }: { card: Scorecard }) {
  if (card.excluded) return <p className="text-xs text-muted">Excluded by hard filter: {card.excluded.reason}</p>;
  return (
    <table className="mt-1 w-full text-xs">
      <tbody>
        {card.components
          ? Object.keys(COMPONENT_LABELS).map((k) => {
              const c = card.components?.[k as keyof NonNullable<Scorecard["components"]>];
              if (!c) return null;
              return (
                <tr key={k} className="border-t border-line/60">
                  <td className="py-0.5 pr-2">{COMPONENT_LABELS[k]}</td>
                  <td className="py-0.5 pr-2 tabular-nums">
                    {c.points} / {c.max}
                  </td>
                  <td className="py-0.5 text-muted">{c.detail}</td>
                </tr>
              );
            })
          : null}
        {card.overrides.map((o) => (
          <tr key={o.key} className="border-t border-line/60">
            <td className="py-0.5 pr-2">Override</td>
            <td className="py-0.5 pr-2 tabular-nums">+{o.points}</td>
            <td className="py-0.5 text-muted">{o.detail}</td>
          </tr>
        ))}
        <tr className="border-t border-line/60">
          <td className="py-0.5 pr-2 font-medium">Total</td>
          <td className="py-0.5 pr-2 tabular-nums font-medium">{card.clamped_total}</td>
          <td className="py-0.5 text-muted">
            raw {card.raw_total} × confidence {card.confidence_multiplier}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** Ranked deal rows with an expandable scorecard per deal. */
export function DealList({ deals, showScore = true, extra }: { deals: DealListItem[]; showScore?: boolean; extra?: (d: DealListItem) => ReactNode }) {
  return (
    <ul className="divide-y divide-line">
      {deals.map((d) => (
        <li key={d.id} className="py-2">
          <details className="group">
            <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1">
              {showScore ? (
                <span className="w-10 shrink-0 text-right font-semibold tabular-nums" title="Relevance score (0–100)">
                  {d.score === null ? "—" : Math.round(d.score)}
                </span>
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="font-medium">{d.company}</span>
                <span className="text-muted">
                  {" "}
                  · {d.stage} · {usd(d.amountUsd)} · {d.sector}
                  {d.city ? ` · ${d.city}` : ""} · {shortDate(d.announced)}
                </span>
                {d.tier && showScore ? (
                  <span className="ml-2">
                    <Badge>{TIER_LABELS[d.tier] ?? d.tier}</Badge>
                  </span>
                ) : null}
                {d.reason ? <span className="block text-xs text-muted">{d.reason}</span> : null}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <Provenance d={d} />
                <SourceLinks sources={d.sources} max={2} />
              </span>
            </summary>
            <div className="mt-2 space-y-1 rounded-md bg-black/[0.03] p-3 text-xs dark:bg-white/[0.04] sm:ml-12">
              {d.description ? <p>{d.description}</p> : null}
              <p>
                <span className="text-muted">Lead:</span> <InvestorLinks list={d.leads} /> · <span className="text-muted">Participating:</span> <InvestorLinks list={d.participants} />
              </p>
              {d.amountRaw ? <p className="text-muted">As reported: {d.amountRaw}</p> : null}
              <p>
                <span className="text-muted">All sources:</span> <SourceLinks sources={d.sources} max={10} />
              </p>
              {extra ? extra(d) : null}
              {d.breakdown ? <ScorecardView card={d.breakdown} /> : null}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

/** Horizontal ranked bars in plain HTML (sector heat, geography, leaderboards). */
export function BarList({
  rows,
}: {
  rows: { key: string; label: ReactNode; value: number; display: ReactNode; highlight?: boolean; indicator?: ReactNode; href?: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-sm">
          <span className="truncate" title={typeof r.label === "string" ? r.label : undefined}>
            {r.indicator ? <span className="mr-1">{r.indicator}</span> : null}
            {r.href ? (
              <Link className="link" href={r.href}>
                {r.label}
              </Link>
            ) : (
              r.label
            )}
          </span>
          <span className="h-3 rounded-sm bg-black/5 dark:bg-white/10">
            <span
              className={`block h-3 rounded-sm ${r.highlight ? "bg-accent" : "bg-[var(--chart-5)]"}`}
              style={{ width: `${Math.max(2, (100 * r.value) / max)}%` }}
            />
          </span>
          <span className="text-right text-xs tabular-nums text-muted">{r.display}</span>
        </li>
      ))}
    </ul>
  );
}
