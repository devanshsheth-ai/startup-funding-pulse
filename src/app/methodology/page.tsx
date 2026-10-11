import { connection } from "next/server";
import { Suspense } from "react";
import { DETECTORS, type DetectorKey } from "@/config/detectors";
import { getDetectorStatus, getProfileConfig, getProvenance, getWorkedExample, listProfiles } from "@/db/queries/methodology";
import { SERENDIPITY_RULE, SIMULATED_PORTFOLIO_DISCLOSURE } from "@/lib/copy";
import { logger } from "@/lib/logger";

/**
 * /methodology (PRD §18.7). Rendered from the active profile's live config and
 * real scored deals: changing a weight in settings changes this page.
 */

export const metadata = { title: "Methodology · Startup Funding Pulse" };

const COMPONENT_ROWS: { key: string; label: string; how: string }[] = [
  { key: "sector_fit", label: "Sector fit", how: "Gemini rates the deal's sector and sub-sector against your core and watch sectors (0–1), cached per sector × sub-sector × mandate, then × weight." },
  { key: "stage_fit", label: "Stage fit", how: "In your stages: full. Adjacent stage or one step away: half. Two steps: one fifth. Otherwise 0. Unnamed rounds score 0." },
  { key: "cheque_fit", label: "Cheque fit", how: "Round size inside your band: full. Within ±50% of the band: half. Outside: 0. Undisclosed: 40% (neutral, never penalised)." },
  { key: "tracked_investor", label: "Tracked investor", how: "A watchlist investor leading: full. Participating: 7/12. Existing: 4/12. Best one counts." },
  { key: "geography_fit", label: "Geography fit", how: "Primary geography: full. Secondary: 60%. Another city: 20%. City not reported: 0." },
  { key: "recency", label: "Recency", how: "Linear across the digest window: newest full, oldest 0." },
  { key: "ecosystem_significance", label: "Ecosystem significance", how: "0.5 × cheque percentile in its stage×sector bucket + 0.3 × investor activity percentile (from our own data) + 0.2 × min(sources ÷ 4, 1). Mandate-independent." },
];

function usd(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  return `$${Math.round(n / 1e3)}K`;
}

async function load(profileParam: string | null) {
  try {
    const [profiles, active] = await Promise.all([listProfiles(), getProfileConfig(profileParam)]);
    if (!active) return { profiles, active: null, example: null, prov: null, detectors: null };
    const [example, prov, detectors] = await Promise.all([getWorkedExample(active.id, active.window.start), getProvenance(), getDetectorStatus(active.id)]);
    return { profiles, active, example, prov, detectors };
  } catch (err) {
    logger.error("methodology load failed", { error: err instanceof Error ? err : String(err) });
    return null;
  }
}

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const sp = await searchParams;
  const profileParam = typeof sp.profile === "string" ? sp.profile : null;
  const data = await load(profileParam);
  if (!data) return <p className="text-sm text-red-700 dark:text-red-300">Methodology data is temporarily unavailable.</p>;
  if (!data.active) return <p className="text-sm">Unknown profile.</p>;
  const { profiles, active, example, prov, detectors } = data;
  const cfg = active.config;
  const w = cfg.scoring_weights;
  const t = cfg.tier_thresholds;

  return (
    <>
      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Profile">
        {profiles.map((p) => (
          <a
            key={p.id}
            href={`/methodology?profile=${p.id}`}
            className={`rounded border px-3 py-1 ${p.id === active.id ? "border-current font-semibold" : "border-black/15 opacity-70 dark:border-white/20"}`}
          >
            {p.displayName}
          </a>
        ))}
      </nav>

      <section>
        <h2 className="mb-2 text-lg font-semibold">1. Scoring weights (live from {active.displayName})</h2>
        <div className="overflow-x-auto rounded border border-black/10 dark:border-white/15">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-black/[0.03] dark:bg-white/[0.05]">
              <tr>
                <th className="px-3 py-2">Component</th>
                <th className="px-3 py-2">Max points</th>
                <th className="px-3 py-2">How it is computed</th>
              </tr>
            </thead>
            <tbody>
              {COMPONENT_ROWS.map((r) => (
                <tr key={r.key} className="border-t border-black/5 align-top dark:border-white/10">
                  <td className="px-3 py-2 font-medium">{r.label}</td>
                  <td className="px-3 py-2">{w[r.key as keyof typeof w]}</td>
                  <td className="px-3 py-2 opacity-85">{r.how}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs opacity-70">
          Mandate: stages {cfg.mandate.stages.join(", ")}; round size {usd(cfg.mandate.round_size_interest_usd.min)}–{usd(cfg.mandate.round_size_interest_usd.max)};
          core sectors {cfg.sectors_core.map((s) => s.name).join(", ")}; primary geographies {cfg.mandate.geographies_primary.join(", ")}.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">2. Worked example (a real deal)</h2>
        {!example ? (
          <p className="text-sm opacity-70">No scored deals yet for this profile.</p>
        ) : (
          <div className="rounded border border-black/10 p-3 text-sm dark:border-white/15">
            <p className="font-medium">
              {example.sourceUrl ? (
                <a className="underline underline-offset-4" href={example.sourceUrl}>
                  {example.company}
                </a>
              ) : (
                example.company
              )}{" "}
              · {example.stage} · {example.amountUsd === null ? "undisclosed" : usd(example.amountUsd)} · {example.sector} · {example.announced}
              {example.publication ? <span className="opacity-60"> · via {example.publication}</span> : null}
            </p>
            {example.card.components ? (
              <table className="mt-2 w-full text-left">
                <tbody>
                  {/* JSONB does not preserve key order: render in rubric order. */}
                  {COMPONENT_ROWS.flatMap((r) => {
                    const c = example.card.components?.[r.key as keyof NonNullable<typeof example.card.components>];
                    return c ? [[r.key, c] as const] : [];
                  }).map(([k, c]) => (
                    <tr key={k} className="border-t border-black/5 dark:border-white/10">
                      <td className="py-1 pr-3">{COMPONENT_ROWS.find((r) => r.key === k)?.label ?? k}</td>
                      <td className="py-1 pr-3 tabular-nums">
                        {c.points} / {c.max}
                      </td>
                      <td className="py-1 opacity-80">{c.detail}</td>
                    </tr>
                  ))}
                  {example.card.overrides.map((o) => (
                    <tr key={o.key} className="border-t border-black/5 dark:border-white/10">
                      <td className="py-1 pr-3">Override</td>
                      <td className="py-1 pr-3 tabular-nums">+{o.points}</td>
                      <td className="py-1 opacity-80">{o.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <p className="mt-2">
              Raw {example.card.raw_total} × confidence {example.card.confidence_multiplier} → shown as <strong>{example.card.clamped_total}</strong> ({example.card.tier.replace("_", " ")})
            </p>
          </div>
        )}
      </section>

      <section className="space-y-1 text-sm">
        <h2 className="mb-2 text-lg font-semibold">3. Overrides</h2>
        <p>
          <strong>+{w.override_watchlist}</strong> when the company is on your watchlist; it always surfaces in the watchlist section.
        </p>
        <p>
          <strong>+{w.override_adjacency_competitor}</strong> when it competes with a tracked company (same product, same customer);{" "}
          <strong>+{w.override_adjacency_same_layer}</strong> when it is the same layer (different product, same customer and budget);{" "}
          <strong>+{w.override_adjacency_adjacent}</strong> when it is a supplier, customer or complement.
        </p>
        <p>
          <strong>+{w.override_investor_first_move}</strong> when a watchlist investor makes its first move into one of your sectors (only once the investor-rotation detector&apos;s
          four guards pass).
        </p>
        <p>
          <strong>Hard filter:</strong> excluded sectors ({cfg.sectors_excluded.join(", ") || "none"}) and keywords score 0 and are archived before any scoring. Exclusion is a
          filter, not a negative weight.
        </p>
        <p>
          <strong>× {w.confidence_discount_single_source}</strong> when only one publication has reported the deal and it is unverified.
        </p>
        <p className="opacity-70">Scores are clamped to 0–100 for display; the raw value is kept in every deal&apos;s breakdown.</p>
      </section>

      <section className="text-sm">
        <h2 className="mb-2 text-lg font-semibold">4. Tiers</h2>
        <ul className="grid gap-1 sm:grid-cols-5">
          <li>🔴 Act now: ≥ {t.act_now}</li>
          <li>🟠 High: {t.high}–{t.act_now - 1}</li>
          <li>🟡 Relevant: {t.relevant}–{t.high - 1}</li>
          <li>⚪ Context: {t.context}–{t.relevant - 1}</li>
          <li>Archive: &lt; {t.context}</li>
        </ul>
      </section>

      <section className="text-sm">
        <h2 className="mb-2 text-lg font-semibold">5. The Serendipity Rule</h2>
        <blockquote className="border-l-4 border-black/20 pl-3 italic dark:border-white/30">{SERENDIPITY_RULE}</blockquote>
        <p className="mt-1 opacity-75">
          Selection: up to {cfg.serendipity.count} deals in the current window whose mandate score (everything except ecosystem significance) is below{" "}
          {cfg.serendipity.max_mandate_score}, whose ecosystem significance is in the top decile, and whose sector is not excluded.
        </p>
      </section>

      <section className="text-sm">
        <h2 className="mb-2 text-lg font-semibold">6. Pattern detectors</h2>
        <p className="mb-2 opacity-75">
          A detector fires only when all three gates pass: sample size ≥ n_min, effect size ≥ e_min and weeks of history ≥ b_min. A detector without enough history is
          shown as <strong>suppressed</strong> with its reason, never silently absent.
          {detectors?.week ? ` Status for ISO week ${detectors.week}.` : " No detector run recorded yet."}
        </p>
        <div className="overflow-x-auto rounded border border-black/10 dark:border-white/15">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-black/[0.03] dark:bg-white/[0.05]">
              <tr>
                <th className="px-3 py-2">Detector</th>
                <th className="px-3 py-2">n_min</th>
                <th className="px-3 py-2">e_min</th>
                <th className="px-3 py-2">b_min</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(DETECTORS) as DetectorKey[]).map((k) => {
                const g = DETECTORS[k];
                const st = detectors?.rows.find((r) => r.key === k);
                const label = st ? (st.status === "fired" ? "active" : st.status) : "not run";
                const cls = st?.status === "fired" ? "text-emerald-700 dark:text-emerald-400" : st?.status === "suppressed" ? "text-amber-700 dark:text-amber-400" : "opacity-70";
                return (
                  <tr key={k} className="border-t border-black/5 align-top dark:border-white/10">
                    <td className="px-3 py-2">
                      <span className="font-medium">{g.label}</span>
                      {g.bestEffort ? <span className="ml-1 rounded bg-black/5 px-1 text-xs dark:bg-white/10">best effort</span> : null}
                      <div className="text-xs opacity-70">{g.signal}</div>
                      {g.note ? <div className="mt-1 text-xs opacity-60">{g.note}</div> : null}
                    </td>
                    <td className="px-3 py-2">{g.nMin === null ? "—" : `${g.nMin} ${g.nUnit}`}</td>
                    <td className="px-3 py-2">{g.eMin === null ? "—" : `${g.eMin} ${g.eUnit}`}</td>
                    <td className="px-3 py-2">{g.bMin} wk</td>
                    <td className={`px-3 py-2 font-medium ${cls}`}>
                      {label}
                      {st && st.findings > 0 ? ` (${st.findings})` : ""}
                    </td>
                    <td className="px-3 py-2 text-xs opacity-80">{st?.reason ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-1 text-sm">
        <h2 className="mb-2 text-lg font-semibold">7. Data provenance</h2>
        {prov ? (
          <>
            <p>
              Sources: {prov.sources.live} live feeds, {prov.sources.backfill} weekly-roundup sources used for backfill, {prov.sources.disabled} disabled (reasons on{" "}
              <a className="underline underline-offset-4" href="/health">
                /health
              </a>
              ).
            </p>
            <p>Deals by ingestion mode: {prov.modes.map((m) => `${m.mode} ${m.n}`).join(" · ")}. History before live operation comes from weekly roundups, not continuous collection.</p>
            <p>
              Deduplication: four layers (domain → normalised name → company embedding plus name agreement → Gemini adjudication), within ±14 days and a compatible stage. Merged
              deals keep every source.
            </p>
            <p>
              Field confidence: <strong>corroborated</strong> = two or more publications agree; <strong>single-source</strong> = one publication;{" "}
              <strong>disputed</strong> = publications disagree (amounts by more than 10%, or different named stages). A deal is verified when two or more publications report it and
              no field is disputed.
            </p>
          </>
        ) : null}
      </section>

      <section className="space-y-2 text-sm">
        <h2 className="mb-2 text-lg font-semibold">8. Assumptions</h2>
        <p>{cfg.assumption_note} Sectors, stages, cheque size, geographies, portfolio and watchlist are assumed defaults, editable in settings.</p>
        <blockquote className="rounded border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          <strong>{SIMULATED_PORTFOLIO_DISCLOSURE.lead}</strong> {SIMULATED_PORTFOLIO_DISCLOSURE.body} <strong>{SIMULATED_PORTFOLIO_DISCLOSURE.emphasis}</strong>{" "}
          {SIMULATED_PORTFOLIO_DISCLOSURE.tail}
        </blockquote>
      </section>
    </>
  );
}

export default function MethodologyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Methodology</h1>
        <p className="text-sm opacity-70">How every deal is ranked. Everything below is rendered from the live profile configuration and real scored deals.</p>
      </header>
      <Suspense fallback={<p className="text-sm opacity-70">Loading methodology…</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
