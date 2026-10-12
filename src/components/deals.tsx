import Link from "next/link";
import type { ReactNode } from "react";
import { usd, shortDate, TIER_HELP, TIER_LABELS } from "@/lib/format";
import type { Scorecard } from "@/pipeline/rubric";
import { Tip } from "./tip";
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
        <Badge tone="good" title={`Verified: ${d.corroboration} independent publications reported this round and agree on the key facts.`}>
          ✓ {d.corroboration} sources
        </Badge>
      ) : (
        <Badge tone="warn" title="Only one publication has reported this round so far. Treat the numbers as provisional until a second source confirms.">
          single source
        </Badge>
      )}
      {d.ingestionMode && d.ingestionMode !== "live" ? <Badge title={d.ingestionMode === "backfill" ? "Backfill: collected from historical articles to build the baseline, not from the live daily run." : "Manual: entered by an admin with a source URL."}>{d.ingestionMode}</Badge> : null}
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
    <div className="mt-2 space-y-1.5">
      {card.components
        ? Object.keys(COMPONENT_LABELS).map((k) => {
            const c = card.components?.[k as keyof NonNullable<Scorecard["components"]>];
            if (!c) return null;
            const pct = c.max ? Math.round((100 * c.points) / c.max) : 0;
            return (
              <div key={k} className="grid grid-cols-[8.5rem_1fr_3.5rem] items-center gap-3 text-xs">
                <Tip text={c.detail} className="cursor-help text-muted underline decoration-dotted decoration-muted/50 underline-offset-2">
                  {COMPONENT_LABELS[k]}
                </Tip>
                <span className="h-2 overflow-hidden rounded-full bg-line/70">
                  <span className="animate-grow block h-2 rounded-full bg-grad" style={{ width: `${Math.max(pct ? 4 : 0, pct)}%` }} />
                </span>
                <span className="text-right font-semibold tabular-nums">
                  {c.points}/{c.max}
                </span>
              </div>
            );
          })
        : null}
      {card.overrides.map((o) => (
        <div key={o.key} className="flex items-center justify-between gap-2 rounded-lg bg-indigo-50 px-2.5 py-1 text-xs text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-200">
          <span>Override · {o.detail}</span>
          <span className="font-bold tabular-nums">+{o.points}</span>
        </div>
      ))}
      <div className="flex items-center justify-between border-t border-line/70 pt-1.5 text-xs">
        <Tip text="Points from the rows above, multiplied by how sure we are of the facts (fewer sources or disputed fields lower it), then capped at 100." className="cursor-help text-muted underline decoration-dotted decoration-muted/50 underline-offset-2">
          Raw {card.raw_total} × confidence {card.confidence_multiplier}
        </Tip>
        <span className="font-bold">Score {card.clamped_total}</span>
      </div>
    </div>
  );
}

const AVATAR = ["from-indigo-500 to-violet-500", "from-cyan-500 to-blue-500", "from-pink-500 to-rose-500", "from-amber-500 to-orange-500", "from-emerald-500 to-teal-500", "from-fuchsia-500 to-purple-500"];
function avatarFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length] ?? AVATAR[0]!;
}
const TIER_RING: Record<string, string> = { act_now: "#e11d48", high: "#f59e0b", relevant: "#6366f1", context: "#94a3b8", archive: "#cbd5e1" };

/** Circular score indicator coloured by tier. */
export function ScoreRing({ score, tier }: { score: number | null; tier: string | null }) {
  const v = Math.max(0, Math.min(100, score ?? 0));
  const c = 2 * Math.PI * 16;
  const color = TIER_RING[tier ?? "context"] ?? "#94a3b8";
  return (
    <Tip text={`Relevance ${score === null ? "not scored" : `${Math.round(score)}/100`} for this profile. ${TIER_HELP[tier ?? ""] ?? ""} Open the row for the breakdown.`}>
      <span className="relative grid h-11 w-11 shrink-0 place-items-center">
      <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90">
        <circle cx="20" cy="20" r="16" fill="none" stroke="var(--grid)" strokeWidth="4" />
        <circle cx="20" cy="20" r="16" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(c * v) / 100} ${c}`}>
          <animate attributeName="stroke-dasharray" from={`0 ${c}`} to={`${(c * v) / 100} ${c}`} dur="0.9s" fill="freeze" />
        </circle>
      </svg>
      <span className="num text-[13px] font-extrabold">{score === null ? "—" : Math.round(score)}</span>
      </span>
    </Tip>
  );
}

const TIER_TONE: Record<string, "bad" | "warn" | "accent" | "neutral"> = { act_now: "bad", high: "warn", relevant: "accent", context: "neutral", archive: "neutral" };

/** Ranked deal rows with an expandable scorecard per deal. */
export function DealList({ deals, showScore = true, extra }: { deals: DealListItem[]; showScore?: boolean; extra?: (d: DealListItem) => ReactNode }) {
  return (
    <ul className="stagger space-y-2">
      {deals.map((d) => (
        <li key={d.id}>
          <details className="group rounded-2xl border border-line/80 bg-card transition-all duration-200 open:shadow-md hover:border-indigo-200 hover:shadow-sm dark:hover:border-indigo-500/30">
            <summary className="flex cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
              {showScore ? (
                <ScoreRing score={d.score} tier={d.tier} />
              ) : (
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-sm font-bold text-white ${avatarFor(d.company)}`}>{d.company.slice(0, 1).toUpperCase()}</span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold">{d.company}</span>
                  {d.tier && showScore ? <Badge tone={TIER_TONE[d.tier] ?? "neutral"} title={TIER_HELP[d.tier]}>{TIER_LABELS[d.tier] ?? d.tier}</Badge> : null}
                </span>
                <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
                  <span className="font-semibold text-foreground">{usd(d.amountUsd)}</span>
                  <span>· {d.stage}</span>
                  <span>· {d.sector}</span>
                  {d.city ? <span>· {d.city}</span> : null}
                  <span>· {shortDate(d.announced)}</span>
                </span>
                {d.reason ? <span className="mt-0.5 block truncate text-xs text-muted">{d.reason}</span> : null}
              </span>
              <span className="hidden max-w-[40%] shrink-0 flex-col items-end gap-1 lg:flex">
                <Provenance d={d} />
                <SourceLinks sources={d.sources} max={1} />
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-muted transition-transform duration-200 group-open:rotate-180" aria-hidden>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <div className="animate-in mx-3 mb-3 space-y-2 rounded-xl bg-card-2 p-3 text-xs ring-1 ring-line/60">
              <div className="flex flex-wrap gap-2 lg:hidden">
                <Provenance d={d} />
              </div>
              {d.description ? <p className="text-[13px] leading-relaxed text-foreground">{d.description}</p> : null}
              <p>
                <span className="text-muted">Lead:</span> <InvestorLinks list={d.leads} /> · <span className="text-muted">Participating:</span> <InvestorLinks list={d.participants} />
              </p>
              {d.amountRaw ? <p className="text-muted">As reported: {d.amountRaw}</p> : null}
              <p>
                <span className="text-muted">Sources:</span> <SourceLinks sources={d.sources} max={10} />
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

/** Horizontal ranked bars in plain HTML (sector heat, geography, leaderboards), animated on load. */
export function BarList({
  rows,
  spread = false,
}: {
  rows: { key: string; label: ReactNode; value: number; display: ReactNode; highlight?: boolean; indicator?: ReactNode; href?: string }[];
  /** Spread rows over the card's spare height instead of leaving a blank strip below them. */
  spread?: boolean;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className={spread ? "flex flex-1 flex-col justify-between gap-2.5" : "space-y-2.5"}>
      {rows.map((r, i) => (
        <li key={r.key} className="group">
          <div className="mb-1 flex items-center justify-between gap-2 text-[13px]">
            <span className="flex min-w-0 items-center gap-1.5 truncate font-medium" title={typeof r.label === "string" ? r.label : undefined}>
              {r.indicator ? <span className="text-xs">{r.indicator}</span> : null}
              {r.href ? (
                <Link className="truncate transition-colors hover:text-accent" href={r.href}>
                  {r.label}
                </Link>
              ) : (
                <span className="truncate">{r.label}</span>
              )}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted">{r.display}</span>
          </div>
          <span className="block h-2.5 overflow-hidden rounded-full bg-line/60">
            <span
              className={`animate-grow block h-2.5 rounded-full ${r.highlight ? "bg-grad" : "bg-gradient-to-r from-slate-300 to-slate-400 dark:from-slate-600 dark:to-slate-500"}`}
              style={{ width: `${Math.max(2, (100 * r.value) / max)}%`, animationDelay: `${Math.min(i, 10) * 50}ms` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
