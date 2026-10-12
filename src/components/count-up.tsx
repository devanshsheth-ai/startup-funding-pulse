"use client";

import { useEffect, useRef, useState } from "react";

/** Animated number for KPI tiles. Formats are fixed strings (functions cannot cross the server boundary). */
type Format = "int" | "usd" | "score";

function fmt(v: number, f: Format, suffix: string): string {
  if (f === "usd") {
    const a = Math.abs(v);
    if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `$${(v / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
    if (a >= 1e3) return `$${Math.round(v / 1e3)}K`;
    return `$${Math.round(v)}`;
  }
  return `${Math.round(v).toLocaleString("en-IN")}${suffix}`;
}

export function CountUp({ value, format = "int", suffix = "", duration = 900 }: { value: number; format?: Format; suffix?: string; duration?: number }) {
  const [shown, setShown] = useState(value);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !Number.isFinite(value)) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      setShown(value * (1 - (1 - p) ** 3));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{fmt(shown, format, suffix)}</>;
}
