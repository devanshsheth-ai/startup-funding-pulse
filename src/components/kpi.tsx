import type { ReactNode } from "react";

/** KPI tile: value, change vs the previous window, and a 12-week sparkline (pure SVG, no JS). */

export function Sparkline({ values, partialLast = true }: { values: (number | null)[]; partialLast?: boolean }) {
  const w = 72;
  const h = 28;
  const pts = values.map((v, i) => ({ i, v }));
  const nums = pts.filter((p): p is { i: number; v: number } => p.v !== null);
  if (nums.length < 2) return <svg width={w} height={h} aria-hidden />;
  const max = Math.max(...nums.map((p) => p.v));
  const min = Math.min(0, ...nums.map((p) => p.v));
  const x = (i: number) => (values.length <= 1 ? 0 : (i / (values.length - 1)) * (w - 4) + 2);
  const y = (v: number) => (max === min ? h / 2 : h - 3 - ((v - min) / (max - min)) * (h - 6));
  const solid = partialLast ? nums.slice(0, -1) : nums;
  const last = nums[nums.length - 1];
  const prev = nums[nums.length - 2];
  const d = solid.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="12-week trend" className="text-accent">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
      {partialLast && last && prev ? (
        <path d={`M${x(prev.i).toFixed(1)},${y(prev.v).toFixed(1)} L${x(last.i).toFixed(1)},${y(last.v).toFixed(1)}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" />
      ) : null}
      {last ? <circle cx={x(last.i)} cy={y(last.v)} r="2" fill="currentColor" /> : null}
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
}: {
  label: string;
  value: ReactNode;
  delta: { text: string; dir: "up" | "down" | "flat" } | null;
  spark: (number | null)[];
  hint: string;
  goodWhenUp?: boolean | null;
}) {
  const tone =
    !delta || delta.dir === "flat" || goodWhenUp === null ? "text-muted" : (delta.dir === "up") === goodWhenUp ? "text-up" : "text-down";
  return (
    <div className="flex flex-col justify-between gap-1 rounded-lg border border-line bg-card p-3" title={hint}>
      <div className="text-xs text-muted">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="flex items-end justify-between gap-2">
        <span className={`whitespace-nowrap text-xs tabular-nums ${tone}`} title="Change vs the previous window of equal length">{delta ? delta.text : "—"}</span>
        <Sparkline values={spark} />
      </div>
    </div>
  );
}
