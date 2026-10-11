"use client";

import { useState } from "react";
import type { DeepDive } from "@/pipeline/deep-dive";

/** "Generate deep-dive" button and renderer; "Save as PDF" uses the browser's print-to-PDF with print CSS. */
export function DeepDivePanel({ sector, profileId }: { sector: string; profileId: string }) {
  const [state, setState] = useState<{ busy: boolean; dd: DeepDive | null; error: string | null; ms: number | null }>({ busy: false, dd: null, error: null, ms: null });
  async function run() {
    const t0 = performance.now();
    setState({ busy: true, dd: null, error: null, ms: null });
    try {
      const res = await fetch(`/api/sectors/${encodeURIComponent(sector)}/deep-dive?profile=${profileId}`, { method: "POST" });
      const dd = (await res.json()) as DeepDive;
      setState({ busy: false, dd, error: dd.ok ? null : dd.error, ms: Math.round(performance.now() - t0) });
    } catch {
      setState({ busy: false, dd: null, error: "The deep-dive request failed.", ms: null });
    }
  }
  const dd = state.dd;
  return (
    <div className="space-y-3">
      <div className="no-print flex flex-wrap items-center gap-2">
        <button type="button" onClick={run} disabled={state.busy} className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-60">
          {state.busy ? "Writing the deep-dive (20–60 s)…" : dd ? "Regenerate deep-dive" : "Generate deep-dive"}
        </button>
        {dd?.ok ? (
          <button type="button" onClick={() => window.print()} className="rounded-md border border-line px-3 py-1.5 text-sm">
            Save as PDF
          </button>
        ) : null}
        {state.ms !== null ? <span className="text-xs text-muted">generated in {(state.ms / 1000).toFixed(1)} s</span> : null}
      </div>
      {state.error ? <p className="text-sm text-down">{state.error}</p> : null}
      {dd?.ok ? (
        <article className="space-y-3">
          <h3 className="text-lg font-semibold">{dd.headline}</h3>
          <p className="text-xs text-muted">
            {dd.sector} · {dd.window.start} → {dd.window.end}. Statistics computed in SQL; prose by Gemini, with every paragraph checked against the deals it cites.
          </p>
          {dd.paragraphs.map((p, i) => (
            <div key={i} className="space-y-1">
              <p className="text-sm leading-relaxed">{p.claim}</p>
              <p className="text-xs text-muted">
                Basis: {p.statBasis} · Evidence:{" "}
                {p.evidenceDealIds.map((id, j) => {
                  const e = dd.evidence[id];
                  return (
                    <span key={id}>
                      {j ? ", " : ""}
                      {e?.url ? (
                        <a className="link" href={e.url} target="_blank" rel="noopener noreferrer">
                          {e.company}
                        </a>
                      ) : (
                        (e?.company ?? id)
                      )}
                    </span>
                  );
                })}
              </p>
            </div>
          ))}
          {dd.rejected.length ? (
            <details className="text-xs text-muted">
              <summary>{dd.rejected.length} paragraph(s) removed by evidence checks</summary>
              <ul className="mt-1 list-disc pl-4">
                {dd.rejected.map((r, i) => (
                  <li key={i}>
                    {r.reason}: “{r.text.slice(0, 140)}…”
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </article>
      ) : null}
    </div>
  );
}
