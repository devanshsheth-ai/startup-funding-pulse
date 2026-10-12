"use client";

import { useState, type ReactNode } from "react";

/** Segmented tabs that keep several related charts in one card instead of three. */
export function Tabs({ tabs }: { tabs: { label: string; content: ReactNode }[] }) {
  const [active, setActive] = useState(0);
  return (
    <div>
      <div role="tablist" className="mb-5 inline-flex flex-wrap gap-1 rounded-xl bg-card-2 p-1 ring-1 ring-line/70">
        {tabs.map((t, i) => (
          <button
            key={t.label}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${i === active ? "bg-card text-accent shadow-sm ring-1 ring-line" : "text-muted hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div key={t.label} role="tabpanel" hidden={i !== active} className={i === active ? "animate-in" : undefined}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
