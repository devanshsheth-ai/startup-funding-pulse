import type { ReactNode } from "react";

/** KPI tile: animated value, change vs the previous window, and a 12-week gradient sparkline (pure SVG). */

const PALETTE = {
  indigo: { chip: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300", stroke: "#6366f1" },
  violet: { chip: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300", stroke: "#8b5cf6" },
  pink: { chip: "bg-pink-50 text-pink-600 dark:bg-pink-500/15 dark:text-pink-300", stroke: "#ec4899" },
  cyan: { chip: "bg-cyan-50 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-300", stroke: "#06b6d4" },
  amber: { chip: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300", stroke: "#f59e0b" },
  emerald: { chip: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300", stroke: "#10b981" },
  rose: { chip: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300", stroke: "#f43f5e" },
} as const;
export type TileColor = keyof typeof PALETTE;

let sparkId = 0;

export function Sparkline({ values, color = "#6366f1", partialLast = true }: { values: (number | null)[]; color?: string; partialLast?: boolean }) {
  const w = 96;
  const h = 34;
  const nums = values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v !== null);
  if (nums.length < 2) return <svg width={w} height={h} aria-hidden />;
  const max = Math.max(...nums.map((p) => p.v));
  const min = Math.min(0, ...nums.map((p) => p.v));
  const x = (i: number) => (values.length <= 1 ? 0 : (i / (values.length - 1)) * (w - 4) + 2);
  const y = (v: number) => (max === min ? h / 2 : h - 3 - ((v - min) / (max - min)) * (h - 8));
  const solid = partialLast ? nums.slice(0, -1) : nums;
  const last = nums[nums.length - 1];
  const prev = nums[nums.length - 2];
  const line = solid.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const first = solid[0];
  const lastSolid = solid[solid.length - 1];
  const area = first && lastSolid ? `${line} L${x(lastSolid.i).toFixed(1)},${h} L${x(first.i).toFixed(1)},${h} Z` : "";
  const id = `spark-${++sparkId}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="12-week trend" className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {area ? <path d={area} fill={`url(#${id})`} /> : null}
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {partialLast && last && prev ? (
        <path d={`M${x(prev.i).toFixed(1)},${y(prev.v).toFixed(1)} L${x(last.i).toFixed(1)},${y(last.v).toFixed(1)}`} fill="none" stroke={color} strokeWidth="2" strokeDasharray="2 3" strokeLinecap="round" />
      ) : null}
      {last ? <circle cx={x(last.i)} cy={y(last.v)} r="3" fill="white" stroke={color} strokeWidth="2" /> : null}
    </svg>
  );
}

export function KpiTile({
  label,
  value,
  delta,
  spark,
  hint,
  goodWhenUp = true,
  icon,
  color = "indigo",
}: {
  label: string;
  value: ReactNode;
  delta: { text: string; dir: "up" | "down" | "flat" } | null;
  spark: (number | null)[];
  hint: string;
  goodWhenUp?: boolean | null;
  icon?: ReactNode;
  color?: TileColor;
}) {
  const tone =
    !delta || delta.dir === "flat" || goodWhenUp === null
      ? "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300"
      : (delta.dir === "up") === goodWhenUp
        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
        : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300";
  const p = PALETTE[color];
  return (
    <div className="card card-hover group relative flex flex-col justify-between gap-3 overflow-hidden p-4" title={hint}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted">{label}</span>
        {icon ? <span className={`grid h-8 w-8 place-items-center rounded-xl transition-transform duration-300 group-hover:scale-110 ${p.chip}`}>{icon}</span> : null}
      </div>
      <div className="num text-[1.7rem] font-extrabold leading-none">{value}</div>
      <div className="flex items-end justify-between gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${tone}`} title="Change vs the previous window of equal length">
          {delta ? delta.text : "—"}
        </span>
        <Sparkline values={spark} color={p.stroke} />
      </div>
    </div>
  );
}

/** Compact secondary stat: icon, label, value and change on one line (no sparkline). */
export function StatChip({ label, value, delta, icon, color = "indigo", hint, goodWhenUp = null }: { label: string; value: ReactNode; delta: { text: string; dir: "up" | "down" | "flat" } | null; icon?: ReactNode; color?: TileColor; hint: string; goodWhenUp?: boolean | null }) {
  const p = PALETTE[color];
  const tone =
    !delta || delta.dir === "flat" || goodWhenUp === null ? "text-muted" : (delta.dir === "up") === goodWhenUp ? "text-up" : "text-down";
  return (
    <div className="card card-hover flex items-center gap-3 px-4 py-3" title={hint}>
      {icon ? <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${p.chip}`}>{icon}</span> : null}
      <span className="min-w-0 flex-1 text-[13px] font-medium text-muted">{label}</span>
      <span className="num text-xl font-extrabold">{value}</span>
      <span className={`w-14 text-right text-xs font-semibold tabular-nums ${tone}`}>{delta ? delta.text : ""}</span>
    </div>
  );
}
