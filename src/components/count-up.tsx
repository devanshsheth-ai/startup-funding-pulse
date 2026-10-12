"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animated number for KPI tiles. Formats are fixed strings (functions cannot
 * cross the server boundary).
 *
 * The tile stays mounted when the profile or window changes via client-side
 * navigation, so the animation must follow every new `value` — not just the
 * first one. It counts from the number currently shown to the new value, and
 * the server-rendered HTML always carries the exact final value.
 */
type Format = "int" | "usd" | "score";

export function formatCount(v: number, f: Format, suffix = ""): string {
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
  // Where the next animation starts: 0 on first mount, then whatever was last shown.
  const from = useRef(0);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (!Number.isFinite(value) || window.matchMedia("(prefers-reduced-motion: reduce)").matches || start === value) {
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      // A frame timestamp can precede t0; clamp so the ease never overshoots below the start.
      const p = Math.max(0, Math.min(1, (t - t0) / duration));
      setShown(start + (value - start) * (1 - (1 - p) ** 3));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // Animation frames pause in background tabs; always land on the exact value.
    const done = setTimeout(() => setShown(value), duration + 50);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
      setShown(value);
    };
  }, [value, duration]);
  return <>{formatCount(shown, format, suffix)}</>;
}
