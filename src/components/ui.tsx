import Link from "next/link";
import type { ReactNode } from "react";
import { SIMULATED_PORTFOLIO_DISCLOSURE } from "@/lib/copy";
import type { ViewProfile, ViewWindow } from "@/lib/view";
import { hrefWith, WINDOW_OPTIONS } from "@/lib/view";

/**
 * Design-system building blocks (server components). Cards are white,
 * rounded and shadowed so sections never blend into the page background;
 * call-to-action buttons use the gradient `.btn-primary`.
 */

export function Page({ title, subtitle, eyebrow, actions, children }: { title: string; subtitle?: ReactNode; eyebrow?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 px-4 py-10 sm:px-6">
      <div className="animate-in flex flex-wrap items-end justify-between gap-4">
        <div>
          {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-[2rem]">{title}</h1>
          {subtitle ? <p className="mt-1.5 max-w-2xl text-[15px] text-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="no-print flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </main>
  );
}

/**
 * Small ⓘ button that reveals details (sample size, method notes) on hover or
 * keyboard/tap focus, so cards stay uncluttered while every number remains
 * explained. CSS-only, works without JavaScript.
 */
export function InfoTip({ children, label = "About this section" }: { children: ReactNode; label?: string }) {
  return (
    <span className="group/info relative inline-flex">
      <button
        type="button"
        aria-label={label}
        className="grid h-7 w-7 place-items-center rounded-full text-muted transition-colors hover:bg-accent-soft hover:text-accent focus-visible:bg-accent-soft focus-visible:text-accent"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute right-0 top-9 z-20 w-72 translate-y-1 rounded-2xl border border-line bg-card p-3.5 text-left text-xs leading-relaxed text-muted opacity-0 shadow-xl transition-all duration-200 group-focus-within/info:pointer-events-auto group-focus-within/info:visible group-focus-within/info:translate-y-0 group-focus-within/info:opacity-100 group-hover/info:pointer-events-auto group-hover/info:visible group-hover/info:translate-y-0 group-hover/info:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}

export function Card({
  title,
  n,
  note,
  children,
  className = "",
  id,
  icon,
  subtitle,
  action,
}: {
  title?: ReactNode;
  n?: number | string;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  icon?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  const hasInfo = note !== undefined || n !== undefined;
  return (
    <section id={id} className={`card card-hover animate-in p-6 ${className}`}>
      {title ? (
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {icon ? <span className="bg-grad-soft grid h-10 w-10 shrink-0 place-items-center rounded-xl text-accent">{icon}</span> : null}
            <div className="min-w-0">
              <h2 className="text-base font-bold leading-6">{title}</h2>
              {subtitle ? <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p> : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {action}
            {hasInfo ? (
              <InfoTip>
                {n !== undefined ? <span className="mb-1 block font-semibold text-foreground">Sample size: n = {n}</span> : null}
                {note}
              </InfoTip>
            ) : null}
          </div>
        </div>
      ) : null}
      {children}
      {!title && note ? <p className="mt-3 text-xs text-muted">{note}</p> : null}
    </section>
  );
}

/** A labelled band that groups related cards on long pages. */
export function SectionHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="animate-in flex flex-wrap items-end justify-between gap-3 pt-4">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-card-2 px-6 py-10 text-center text-sm text-muted ring-1 ring-line/60">
      <svg width="88" height="64" viewBox="0 0 88 64" fill="none" aria-hidden>
        <defs>
          <linearGradient id="emptyGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6366f1" stopOpacity="0.25" />
            <stop offset="1" stopColor="#ec4899" stopOpacity="0.25" />
          </linearGradient>
        </defs>
        <ellipse cx="44" cy="56" rx="30" ry="5" fill="#94a3b8" opacity="0.18" />
        <rect x="14" y="8" width="60" height="40" rx="12" fill="url(#emptyGrad)" />
        <rect x="24" y="30" width="7" height="10" rx="2" fill="#6366f1" opacity="0.55" />
        <rect x="35" y="22" width="7" height="18" rx="2" fill="#8b5cf6" opacity="0.55" />
        <rect x="46" y="26" width="7" height="14" rx="2" fill="#ec4899" opacity="0.55" />
        <rect x="57" y="18" width="7" height="22" rx="2" fill="#06b6d4" opacity="0.5" />
      </svg>
      <span className="max-w-xs">{children}</span>
    </div>
  );
}

const TONES = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-white/10 dark:text-slate-200 dark:ring-white/10",
  good: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/20",
  warn: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/20",
  bad: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/20",
  accent: "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/20",
} as const;

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: keyof typeof TONES; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Pills({ items, label }: { items: { href: string; label: string; active: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="no-print inline-flex max-w-full flex-wrap gap-1 rounded-2xl bg-card p-1 shadow-sm ring-1 ring-line">
      {items.map((i) => (
        <Link
          key={i.href + i.label}
          href={i.href}
          className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
            i.active ? "bg-grad text-white shadow-[0_4px_12px_-4px_rgb(99_102_241/0.55)]" : "text-muted hover:bg-accent-soft hover:text-accent"
          }`}
          aria-current={i.active ? "true" : undefined}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function ProfileSwitcher({ path, sp, profiles, active }: { path: string; sp: Record<string, string | string[] | undefined>; profiles: ViewProfile[]; active: ViewProfile }) {
  return <Pills label="Profile" items={profiles.map((p) => ({ href: hrefWith(path, sp, { profile: p.id, cursor: null }), label: p.displayName, active: p.id === active.id }))} />;
}

export function WindowSelector({ path, sp, win }: { path: string; sp: Record<string, string | string[] | undefined>; win: ViewWindow }) {
  return <Pills label="Window" items={WINDOW_OPTIONS.map((o) => ({ href: hrefWith(path, sp, { window: o.key }), label: o.label, active: o.key === win.key }))} />;
}

export function Disclosure() {
  return (
    <div role="note" className="animate-in flex gap-3 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4 text-sm text-amber-950 shadow-sm dark:border-amber-500/30 dark:from-amber-500/10 dark:to-orange-500/10 dark:text-amber-100">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" aria-hidden>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16h.01" />
        </svg>
      </span>
      <p className="leading-relaxed">
        <strong>{SIMULATED_PORTFOLIO_DISCLOSURE.lead}</strong> {SIMULATED_PORTFOLIO_DISCLOSURE.body} <strong>{SIMULATED_PORTFOLIO_DISCLOSURE.emphasis}</strong>{" "}
        {SIMULATED_PORTFOLIO_DISCLOSURE.tail}
      </p>
    </div>
  );
}

export function Unavailable({ what }: { what: string }) {
  return (
    <p className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
      {what} is temporarily unavailable. The pipeline status is on{" "}
      <Link className="link" href="/health">
        /health
      </Link>
      , and the{" "}
      <Link className="link" href="/brief">
        latest brief
      </Link>{" "}
      is always available.
    </p>
  );
}

/** Shimmering skeleton while server components stream in. */
export function Loading({ what }: { what: string }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label={`Loading ${what}`}>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton h-28" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="skeleton h-72 lg:col-span-2" />
        <div className="skeleton h-72" />
      </div>
      <p className="sr-only">Loading {what}…</p>
    </div>
  );
}

/** Responsive table with a soft header row and row hover. */
export function Table({ head, children, minWidth = 640 }: { head: ReactNode[]; children: ReactNode; minWidth?: number }) {
  return (
    <div className="-mx-1 overflow-x-auto rounded-xl">
      <table className="w-full text-left text-sm [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-accent-soft/50" style={{ minWidth }}>
        <thead>
          <tr className="bg-card-2 text-[11px] uppercase tracking-wide text-muted">
            {head.map((h, i) => (
              <th key={i} className={`px-3 py-2.5 font-semibold ${i === 0 ? "rounded-l-xl" : ""} ${i === head.length - 1 ? "rounded-r-xl" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const td = "px-3 py-2.5 align-top border-b border-line/60";

/** Small inline icons (stroke, currentColor) used in card headers and tiles. */
export const Icon = {
  chart: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-4 3 3 5-6" />
    </svg>
  ),
  layers: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m12 3 9 5-9 5-9-5 9-5z" />
      <path d="m3 13 9 5 9-5" />
    </svg>
  ),
  flame: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3c2 3 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-8z" />
    </svg>
  ),
  pin: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  ),
  users: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" />
    </svg>
  ),
  bell: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  ),
  star: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3z" />
    </svg>
  ),
  pie: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12A9 9 0 1 1 12 3v9h9z" />
      <path d="M15 3.5A9 9 0 0 1 20.5 9H15V3.5z" />
    </svg>
  ),
  list: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  ),
  link: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </svg>
  ),
  gauge: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="m12 14 4-4" />
    </svg>
  ),
  grid: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </svg>
  ),
};
