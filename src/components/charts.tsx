"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from "recharts";
import { SERIES } from "@/lib/chart-colors";

/**
 * Client-side Recharts wrappers. Pages compute every number on the server and
 * pass plain arrays in; these components only draw. Gradient fills, rounded
 * bars and short entrance animations; colours are CSS tokens so both themes work.
 */

const money = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${Math.round(v / 1e6)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${v}`);
const wk = (w: string) => w.replace(/^\d{4}-/, "");
const axis = { stroke: "var(--muted)", fontSize: 11, tickLine: false, axisLine: false } as const;
const anim = { isAnimationActive: true, animationDuration: 900, animationEasing: "ease-out" } as const;
const tooltipStyle = {
  contentStyle: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, fontSize: 12, boxShadow: "0 12px 32px -12px rgb(15 23 42 / 0.25)", padding: "8px 12px" },
  labelStyle: { color: "var(--foreground)", fontWeight: 600 },
  cursor: { fill: "var(--accent-soft)", opacity: 0.6 },
};
const legend = { wrapperStyle: { fontSize: 12, paddingTop: 6 }, iconType: "circle" as const, iconSize: 8 };


function Grad({ id, color, from = 0.9, to = 0.35, vertical = true }: { id: string; color: string; from?: number; to?: number; vertical?: boolean }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2={vertical ? "0" : "1"} y2={vertical ? "1" : "0"}>
      <stop offset="0%" stopColor={color} stopOpacity={from} />
      <stop offset="100%" stopColor={color} stopOpacity={to} />
    </linearGradient>
  );
}

export function CapitalCountChart({ data }: { data: { week: string; capital: number; n: number; partial: boolean }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data.map((d) => ({ ...d, label: d.partial ? `${wk(d.week)}*` : wk(d.week) }))} margin={{ top: 10, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <Grad id="capBar" color="var(--chart-1)" from={0.95} to={0.45} />
        </defs>
        <CartesianGrid stroke="var(--grid)" vertical={false} strokeDasharray="4 4" />
        <XAxis dataKey="label" {...axis} />
        <YAxis yAxisId="cap" tickFormatter={money} {...axis} width={52} />
        <YAxis yAxisId="n" orientation="right" allowDecimals={false} {...axis} width={28} />
        <Tooltip {...tooltipStyle} formatter={(v, name) => (name === "Capital" ? money(Number(v)) : v)} />
        <Legend {...legend} />
        <Bar yAxisId="cap" dataKey="capital" name="Capital" fill="url(#capBar)" radius={[8, 8, 3, 3]} maxBarSize={36} {...anim} />
        <Line yAxisId="n" dataKey="n" name="Deals" stroke="var(--chart-4)" strokeWidth={2.5} dot={{ r: 3, strokeWidth: 2, fill: "var(--card)" }} activeDot={{ r: 5 }} type="monotone" {...anim} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function StageMixChart({ data, keys }: { data: Record<string, number | string>[]; keys: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={230}>
      <AreaChart data={data} stackOffset="expand" margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <defs>
          {keys.map((k, i) => (
            <Grad key={k} id={`stage-${i}`} color={SERIES[i % SERIES.length] ?? "var(--chart-1)"} from={0.75} to={0.25} />
          ))}
        </defs>
        <CartesianGrid stroke="var(--grid)" vertical={false} strokeDasharray="4 4" />
        <XAxis dataKey="label" {...axis} />
        <YAxis tickFormatter={(v: number) => `${Math.round(v * 100)}%`} {...axis} width={40} />
        <Tooltip {...tooltipStyle} formatter={(v) => money(Number(v))} />
        <Legend {...legend} />
        {keys.map((k, i) => (
          <Area key={k} type="monotone" dataKey={k} stackId="1" stroke={SERIES[i % SERIES.length]} strokeWidth={2} fill={`url(#stage-${i})`} {...anim} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function HistogramChart({ data, medianLabel }: { data: { label: string; n: number }[]; medianLabel: string | null }) {
  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={data} margin={{ top: 18, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <Grad id="histBar" color="var(--chart-2)" from={0.95} to={0.45} />
        </defs>
        <CartesianGrid stroke="var(--grid)" vertical={false} strokeDasharray="4 4" />
        <XAxis dataKey="label" {...axis} interval={0} angle={-30} textAnchor="end" height={48} />
        <YAxis allowDecimals={false} {...axis} width={28} />
        <Tooltip {...tooltipStyle} />
        <Bar dataKey="n" name="Deals" fill="url(#histBar)" radius={[8, 8, 3, 3]} {...anim} />
        {medianLabel ? <ReferenceLine x={medianLabel} stroke="var(--chart-4)" strokeWidth={2} strokeDasharray="5 4" label={{ value: "median", position: "top", fill: "var(--chart-4)", fontSize: 11, fontWeight: 600 }} /> : null}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ShareLine({ data, label, baseline }: { data: { week: string; value: number | null }[]; label: string; baseline?: number | null }) {
  return (
    <ResponsiveContainer width="100%" height={150}>
      <AreaChart data={data.map((d) => ({ ...d, label: wk(d.week) }))} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <Grad id="shareArea" color="var(--chart-7)" from={0.4} to={0} />
        </defs>
        <CartesianGrid stroke="var(--grid)" vertical={false} strokeDasharray="4 4" />
        <XAxis dataKey="label" {...axis} />
        <YAxis domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} {...axis} width={40} />
        <Tooltip {...tooltipStyle} formatter={(v) => `${Math.round(Number(v) * 100)}%`} />
        {baseline != null ? <ReferenceLine y={baseline} stroke="var(--muted)" strokeDasharray="4 3" /> : null}
        <Area dataKey="value" name={label} type="monotone" stroke="var(--chart-7)" strokeWidth={2.5} fill="url(#shareArea)" connectNulls dot={{ r: 2.5 }} {...anim} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Generic multi-series chart over ISO weeks; the first series is drawn as a soft area. */
export function WeekLines({ data, series, money: isMoney = false, height = 240 }: { data: Record<string, number | string | null>[]; series: { key: string; label: string }[]; money?: boolean; height?: number }) {
  const uid = series.map((s) => s.key).join("-");
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s, i) => (
            <Grad key={s.key} id={`wl-${uid}-${i}`} color={SERIES[i % SERIES.length] ?? "var(--chart-1)"} from={0.35} to={0} />
          ))}
        </defs>
        <CartesianGrid stroke="var(--grid)" vertical={false} strokeDasharray="4 4" />
        <XAxis dataKey="label" {...axis} />
        <YAxis tickFormatter={isMoney ? money : undefined} allowDecimals={false} {...axis} width={isMoney ? 52 : 32} />
        <Tooltip {...tooltipStyle} formatter={(v) => (isMoney ? money(Number(v)) : v)} />
        {series.length > 1 ? <Legend {...legend} /> : null}
        {series.map((s, i) =>
          i === 0 ? (
            <Area key={s.key} dataKey={s.key} name={s.label} type="monotone" stroke={SERIES[0]} strokeWidth={2.5} fill={`url(#wl-${uid}-0)`} connectNulls dot={{ r: 2.5 }} {...anim} />
          ) : (
            <Line key={s.key} dataKey={s.key} name={s.label} type="monotone" stroke={SERIES[i % SERIES.length]} strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls {...anim} />
          ),
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Donut with a centred total (stage mix, status splits). */
export function Donut({ data, centerLabel, centerValue, money: isMoney = false, height = 220 }: { data: { name: string; value: number }[]; centerLabel: string; centerValue: string; money?: boolean; height?: number }) {
  const shown = data.filter((d) => d.value > 0);
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip {...tooltipStyle} formatter={(v) => (isMoney ? money(Number(v)) : v)} />
          <Pie data={shown} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={3} cornerRadius={8} stroke="none" {...anim}>
            {shown.map((d, i) => (
              <Cell key={d.name} fill={SERIES[i % SERIES.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="num text-xl font-extrabold">{centerValue}</div>
          <div className="text-[11px] text-muted">{centerLabel}</div>
        </div>
      </div>
    </div>
  );
}

interface TreeDatum {
  name: string;
  size: number;
  capital: number;
  n: number;
  delta: number;
  core: boolean;
  href: string;
  /** Optional second line and tooltip text replacing the week-on-week change. */
  caption?: string;
  [key: string]: string | number | boolean | undefined;
}

/** Colour by week-on-week change in deal count: greens rising, roses cooling, slate flat. */
function heatColor(delta: number): string {
  if (delta >= 3) return "#059669";
  if (delta >= 1) return "#10b981";
  if (delta <= -3) return "#e11d48";
  if (delta <= -1) return "#fb7185";
  return "#94a3b8";
}

function TreeCell(props: { x?: number; y?: number; width?: number; height?: number; name?: string; capital?: number; n?: number; delta?: number; core?: boolean; href?: string; depth?: number; caption?: string }) {
  const { x = 0, y = 0, width = 0, height = 0, name = "", capital = 0, n = 0, delta = 0, core = false, href = "#", depth = 1, caption } = props;
  if (depth !== 1 || width <= 2 || height <= 2) return null;
  const fill = heatColor(delta);
  const big = width > 90 && height > 46;
  return (
    <a href={href}>
      <g style={{ cursor: "pointer" }}>
        <rect x={x + 2} y={y + 2} width={width - 4} height={height - 4} rx={12} fill={fill} fillOpacity={core ? 0.95 : 0.62} stroke={core ? "var(--foreground)" : "none"} strokeOpacity={0.25} strokeWidth={core ? 1.5 : 0} />
        {width > 54 && height > 24 ? (
          <text x={x + 12} y={y + 22} fill="#fff" fontSize={big ? 13 : 11} fontWeight={700}>
            {name.length > Math.floor(width / 8) ? `${name.slice(0, Math.max(3, Math.floor(width / 8) - 1))}…` : name}
          </text>
        ) : null}
        {big ? (
          <text x={x + 12} y={y + 40} fill="#fff" fillOpacity={0.9} fontSize={11}>
            {caption ?? `${money(capital)} · ${n} deal${n === 1 ? "" : "s"} ${delta > 0 ? `▲${delta}` : delta < 0 ? `▼${Math.abs(delta)}` : ""}`}
          </text>
        ) : null}
      </g>
    </a>
  );
}

/** Sector treemap: area = disclosed capital, colour = change in deal count vs the previous window. */
export function SectorTreemap({ data, height = 300 }: { data: TreeDatum[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Treemap data={data} dataKey="size" nameKey="name" isAnimationActive animationDuration={700} content={<TreeCell />}>
        <Tooltip
          {...tooltipStyle}
          formatter={(_v, _n, item) => {
            const p = (item as { payload?: TreeDatum }).payload;
            return p ? [p.caption ?? `${money(p.capital)} · ${p.n} deals · ${p.delta >= 0 ? "+" : ""}${p.delta} vs previous`, p.name] : "";
          }}
        />
      </Treemap>
    </ResponsiveContainer>
  );
}
