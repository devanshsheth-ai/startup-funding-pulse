"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/", label: "Overview", hint: "The dashboard: market pulse, your portfolio and the top deals for the selected window." },
  { href: "/brief", label: "Brief", hint: "Your weekly brief on the web: summary, alerts, analysis, patterns and every ranked deal." },
  { href: "/trends", label: "Trends", hint: "Capital, deal count and stage mix over the last 14 weeks, with the patterns that fired." },
  { href: "/investors", label: "Investors", hint: "Leaderboard, new entrants, the co-investment graph and a warm-path finder." },
  { href: "/portfolio", label: "Portfolio", hint: "Your tracked (simulated) companies and the raises happening around them." },
  { href: "/alerts", label: "Alerts", hint: "Every alert the engine raised and whether it was sent, batched into the brief or skipped." },
  { href: "/explorer", label: "Explorer", hint: "Search and filter every deal and event, in plain English or with filters, and export CSV." },
  { href: "/sectors", label: "Sectors", hint: "Where capital went by sector, with a page and AI deep dive per sector." },
  { href: "/methodology", label: "Methodology", hint: "How deals are collected, verified, scored and turned into patterns." },
  { href: "/settings", label: "Settings", hint: "Edit a profile's mandate, scoring weights, watchlist and tracked companies." },
  { href: "/health", label: "Health", hint: "Pipeline runs, source status, data coverage and Gemini usage." },
];

/** Top navigation, horizontally scrollable on small screens. Carries `?profile=` across pages. */
export function Nav() {
  const path = usePathname();
  const sp = useSearchParams();
  const profile = sp.get("profile");
  // The nav scrolls sideways, which would clip a CSS tooltip, so this one is fixed-positioned.
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const show = (el: HTMLElement, text: string) => {
    const r = el.getBoundingClientRect();
    setTip({ text, x: Math.min(Math.max(r.left + r.width / 2, 150), window.innerWidth - 150), y: r.bottom + 8 });
  };
  return (
    <>
      <nav aria-label="Main" className="no-scrollbar flex gap-1 overflow-x-auto text-sm" onMouseLeave={() => setTip(null)}>
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={profile ? `${l.href}?profile=${encodeURIComponent(profile)}` : l.href}
            className={`shrink-0 rounded-full px-3.5 py-1.5 font-medium transition-all duration-200 ${
              active ? "bg-[#e8f4fb] font-semibold text-[#035f91] dark:bg-[#10293a] dark:text-[#7dd3fc]" : "text-muted hover:bg-card-2 hover:text-foreground"
            }`}
            aria-current={active ? "page" : undefined}
            onMouseEnter={(e) => show(e.currentTarget, l.hint)}
            onFocus={(e) => show(e.currentTarget, l.hint)}
            onBlur={() => setTip(null)}
            onClick={() => setTip(null)}
          >
            {l.label}
          </Link>
        );
      })}
      </nav>
      {tip ? (
        <span role="tooltip" className="animate-in pointer-events-none fixed z-50 w-max max-w-[18rem] -translate-x-1/2 rounded-xl bg-slate-900 px-3 py-2 text-[11.5px] font-medium leading-snug text-white shadow-xl dark:bg-slate-700" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </span>
      ) : null}
    </>
  );
}
