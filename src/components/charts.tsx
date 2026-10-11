"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Client-side Recharts wrappers. Pages compute every number on the server and
 * pass plain arrays in; these components only draw.
 */

const money = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${Math.round(v / 1e6)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${v}`);
const wk = (w: string) => w.replace(/^\d{4}-/, "");
const axis = { stroke: "var(--muted)", fontSize: 11, tickLine: false } as const;
const tooltipStyle = { contentStyle: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }, labelStyle: { color: "var(--foreground)" } };

export function CapitalCountChart({ data }: { data: { week: string; capital: number; n: number; partial: boolean }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data.map((d) => ({ ...d, label: d.partial ? `${wk(d.week)}*` : wk(d.week) }))} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" {...axis} />
        <YAxis yAxisId="cap" tickFormatter={money} {...axis} width={52} />
        <YAxis yAxisId="n" orientation="right" allowDecimals={false} {...axis} width={28} />
        <Tooltip {...tooltipStyle} formatter={(v, name) => (name === "Capital" ? money(Number(v)) : v)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar isAnimationActive={false} yAxisId="cap" dataKey="capital" name="Capital" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
        <Line isAnimationActive={false} yAxisId="n" dataKey="n" name="Deals" stroke="var(--chart-3)" strokeWidth={2} dot={{ r: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function StageMixChart({ data, keys }: { data: Record<string, number | string>[]; keys: string[] }) {
  const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-5)"];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} stackOffset="expand" margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" {...axis} />
        <YAxis tickFormatter={(v: number) => `${Math.round(v * 100)}%`} {...axis} width={40} />
        <Tooltip {...tooltipStyle} formatter={(v) => money(Number(v))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {keys.map((k, i) => (
          <Area isAnimationActive={false} key={k} type="monotone" dataKey={k} stackId="1" stroke={colors[i % colors.length]} fill={colors[i % colors.length]} fillOpacity={0.55} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function HistogramChart({ data, medianLabel }: { data: { label: string; n: number }[]; medianLabel: string | null }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 16, right: 4, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" {...axis} interval={0} angle={-30} textAnchor="end" height={48} />
        <YAxis allowDecimals={false} {...axis} width={28} />
        <Tooltip {...tooltipStyle} />
        <Bar isAnimationActive={false} dataKey="n" name="Deals" fill="var(--chart-2)" radius={[3, 3, 0, 0]} />
        {medianLabel ? <ReferenceLine x={medianLabel} stroke="var(--chart-3)" strokeDasharray="4 3" label={{ value: "median", position: "top", fill: "var(--chart-3)", fontSize: 11 }} /> : null}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ShareLine({ data, label, baseline }: { data: { week: string; value: number | null }[]; label: string; baseline?: number | null }) {
  return (
    <ResponsiveContainer width="100%" height={140}>
      <LineChart data={data.map((d) => ({ ...d, label: wk(d.week) }))} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" {...axis} />
        <YAxis domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} {...axis} width={40} />
        <Tooltip {...tooltipStyle} formatter={(v) => `${Math.round(Number(v) * 100)}%`} />
        {baseline != null ? <ReferenceLine y={baseline} stroke="var(--muted)" strokeDasharray="4 3" /> : null}
        <Line isAnimationActive={false} dataKey="value" name={label} stroke="var(--chart-4)" strokeWidth={2} dot={{ r: 2 }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Generic multi-series line chart over ISO weeks (trends page, sector page). */
export function WeekLines({ data, series, money: isMoney = false, height = 240 }: { data: Record<string, number | string | null>[]; series: { key: string; label: string }[]; money?: boolean; height?: number }) {
  const colors = ["var(--chart-1)", "var(--chart-3)", "var(--chart-2)", "var(--chart-4)", "var(--chart-5)"];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" {...axis} />
        <YAxis tickFormatter={isMoney ? money : undefined} allowDecimals={false} {...axis} width={isMoney ? 52 : 32} />
        <Tooltip {...tooltipStyle} formatter={(v) => (isMoney ? money(Number(v)) : v)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => (
          <Line isAnimationActive={false} key={s.key} dataKey={s.key} name={s.label} stroke={colors[i % colors.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
