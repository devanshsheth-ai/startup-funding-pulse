import Link from "next/link";
import type { ReactNode } from "react";
import { SIMULATED_PORTFOLIO_DISCLOSURE } from "@/lib/copy";
import type { ViewProfile, ViewWindow } from "@/lib/view";
import { hrefWith, WINDOW_OPTIONS } from "@/lib/view";

/** Small presentational building blocks shared by every page (server components). */

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="no-print flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </main>
  );
}

export function Card({ title, n, note, children, className = "", id }: { title?: ReactNode; n?: number | string; note?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`rounded-lg border border-line bg-card p-4 ${className}`}>
      {title ? (
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {n !== undefined ? <span className="text-xs tabular-nums text-muted">n = {n}</span> : null}
        </div>
      ) : null}
      {children}
      {note ? <p className="mt-2 text-xs text-muted">{note}</p> : null}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-center text-sm text-muted">{children}</p>;
}

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "accent"; title?: string }) {
  const cls = {
    neutral: "bg-black/5 dark:bg-white/10",
    good: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
    warn: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
    bad: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
    accent: "bg-indigo-100 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-200",
  }[tone];
  return (
    <span title={title} className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-none ${cls}`}>
      {children}
    </span>
  );
}

export function Pills({ items, label }: { items: { href: string; label: string; active: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="no-print flex flex-wrap gap-1 text-xs">
      {items.map((i) => (
        <Link
          key={i.href + i.label}
          href={i.href}
          className={`rounded-full border px-2.5 py-1 ${i.active ? "border-foreground bg-foreground text-background" : "border-line text-muted hover:text-foreground"}`}
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
    <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
      <strong>{SIMULATED_PORTFOLIO_DISCLOSURE.lead}</strong> {SIMULATED_PORTFOLIO_DISCLOSURE.body} <strong>{SIMULATED_PORTFOLIO_DISCLOSURE.emphasis}</strong>{" "}
      {SIMULATED_PORTFOLIO_DISCLOSURE.tail}
    </div>
  );
}

export function Unavailable({ what }: { what: string }) {
  return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{what} is temporarily unavailable. The pipeline status is on /health.</p>;
}

export function Loading({ what }: { what: string }) {
  return <p className="text-sm text-muted">Loading {what}…</p>;
}

/** Simple responsive table wrapper with consistent cell padding. */
export function Table({ head, children, minWidth = 640 }: { head: ReactNode[]; children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        <thead className="text-xs text-muted">
          <tr className="border-b border-line">
            {head.map((h, i) => (
              <th key={i} className="px-2 py-1.5 font-medium">
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

export const td = "px-2 py-1.5 align-top border-b border-line/60";
