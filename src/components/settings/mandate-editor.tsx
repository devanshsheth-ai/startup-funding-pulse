"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { adminFetch, RegenerateButton } from "@/components/admin";
import type { MandateConfig } from "@/config/profile";

/**
 * Full mandate editor (PRD §18.8): sectors, stages, cheque range, geographies,
 * exclusions, delivery, alerts and the Tune weights panel. Saves the whole
 * config object; the server validates it with the seed schema.
 */

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const BASE_WEIGHTS = ["sector_fit", "stage_fit", "cheque_fit", "tracked_investor", "geography_fit", "recency", "ecosystem_significance"] as const;
const OVERRIDES = ["override_watchlist", "override_adjacency_competitor", "override_adjacency_same_layer", "override_adjacency_adjacent", "override_investor_first_move"] as const;
const label = (k: string) => k.replace(/^override_/, "").replace(/_/g, " ");
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const input = "rounded-md border border-line bg-background px-2 py-1 text-sm";

/** Comma-separated list field: edits a local string, commits the parsed list on blur. */
function ListInput({ value, onChange, className = "", ...rest }: { value: string[]; onChange: (v: string[]) => void; className?: string; placeholder?: string; "aria-label"?: string }) {
  const [text, setText] = useState(value.join(", "));
  return <input {...rest} className={`${input} ${className}`} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onChange(list(text))} />;
}

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <fieldset className="space-y-2 rounded-lg border border-line bg-card p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      {children}
    </fieldset>
  );
}

export function MandateEditor({ profileId, initial, sectors, stages, triggerKeys, digestToOverride }: { profileId: string; initial: MandateConfig; sectors: string[]; stages: string[]; triggerKeys: string[]; digestToOverride: boolean }) {
  const router = useRouter();
  const [cfg, setCfg] = useState<MandateConfig>(initial);
  const [rev, setRev] = useState(0); // remounts list inputs on discard
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "ok" | "error"; msg?: string; issues?: { path: string; message: string }[] }>({ kind: "idle" });
  const set = (patch: Partial<MandateConfig>) => setCfg((c) => ({ ...c, ...patch }));
  const m = cfg.mandate;
  const setM = (patch: Partial<MandateConfig["mandate"]>) => set({ mandate: { ...m, ...patch } });

  const role = (s: string) => (cfg.sectors_core.some((c) => c.name === s) ? "core" : cfg.sectors_watch.includes(s) ? "watch" : cfg.sectors_excluded.includes(s) ? "excluded" : "none");
  function setRole(s: string, r: string) {
    const core = cfg.sectors_core.filter((c) => c.name !== s);
    const prev = cfg.sectors_core.find((c) => c.name === s);
    set({
      sectors_core: r === "core" ? [...core, { name: s, sub: prev?.sub ?? [] }] : core,
      sectors_watch: r === "watch" ? [...cfg.sectors_watch.filter((x) => x !== s), s] : cfg.sectors_watch.filter((x) => x !== s),
      sectors_excluded: r === "excluded" ? [...cfg.sectors_excluded.filter((x) => x !== s), s] : cfg.sectors_excluded.filter((x) => x !== s),
    });
  }
  const toggle = <T extends string>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const subExclusions = cfg.sectors_excluded.filter((x) => !sectors.includes(x));
  const baseTotal = BASE_WEIGHTS.reduce((a, k) => a + cfg.scoring_weights[k], 0);

  async function save() {
    setStatus({ kind: "saving" });
    try {
      const res = await adminFetch(`/api/profile/${profileId}/config`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
      const body = (await res.json()) as { ok: boolean; error?: string; issues?: { path: string; message: string }[] };
      if (!body.ok) return setStatus({ kind: "error", msg: body.error ?? "Save failed", issues: body.issues });
      setStatus({ kind: "ok", msg: "Saved. Regenerate to rescore deals against the new mandate." });
      router.refresh();
    } catch (err) {
      setStatus({ kind: "error", msg: err instanceof Error ? err.message : "Save failed" });
    }
  }

  return (
    <div key={rev} className="space-y-4">
      <Section title="Sectors" hint="Core sectors drive sector fit; list the sub-sectors you care most about. Excluded sectors are a hard filter, applied before scoring.">
        <div className="grid gap-1 sm:grid-cols-2">
          {sectors.map((s) => {
            const r = role(s);
            const core = cfg.sectors_core.find((c) => c.name === s);
            return (
              <div key={s} className="flex flex-wrap items-center gap-2 text-sm">
                <select value={r} onChange={(e) => setRole(s, e.target.value)} className={`${input} w-28`} aria-label={`${s} role`}>
                  <option value="none">—</option>
                  <option value="core">core</option>
                  <option value="watch">watch</option>
                  <option value="excluded">excluded</option>
                </select>
                <span className={r === "core" ? "font-medium" : r === "excluded" ? "text-down line-through" : ""}>{s}</span>
                {core ? (
                  <ListInput
                    className="min-w-0 flex-1"
                    value={core.sub}
                    placeholder="sub-sectors, comma-separated"
                    aria-label={`${s} sub-sectors`}
                    onChange={(v) => set({ sectors_core: cfg.sectors_core.map((c) => (c.name === s ? { ...c, sub: v } : c)) })}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
        <label className="block text-sm">
          Excluded keywords (comma-separated; any match archives the deal)
          <ListInput className="mt-1 w-full" value={cfg.keywords_excluded} onChange={(v) => set({ keywords_excluded: v })} />
        </label>
        <label className="block text-sm">
          Sub-sector exclusion labels (shown on methodology; enforced through the keywords above)
          <ListInput className="mt-1 w-full" value={subExclusions} onChange={(v) => set({ sectors_excluded: [...cfg.sectors_excluded.filter((x) => sectors.includes(x)), ...v] })} />
        </label>
      </Section>

      <Section title="Stages and cheque size">
        <div className="text-sm">
          <div className="mb-1 text-xs text-muted">Mandate stages (full stage fit)</div>
          <div className="flex flex-wrap gap-3">
            {stages.map((s) => (
              <label key={s} className="flex items-center gap-1">
                <input type="checkbox" checked={m.stages.includes(s)} onChange={() => setM({ stages: toggle(m.stages, s) })} /> {s}
              </label>
            ))}
          </div>
          <div className="mb-1 mt-3 text-xs text-muted">Adjacent stages (half stage fit)</div>
          <div className="flex flex-wrap gap-3">
            {stages.map((s) => (
              <label key={s} className="flex items-center gap-1">
                <input type="checkbox" checked={m.stages_adjacent.includes(s)} onChange={() => setM({ stages_adjacent: toggle(m.stages_adjacent, s) })} /> {s}
              </label>
            ))}
          </div>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          {(["cheque_size_usd", "round_size_interest_usd"] as const).map((k) => (
            <div key={k}>
              <div className="text-xs text-muted">{k === "cheque_size_usd" ? "Your cheque size (USD millions)" : "Round size of interest (USD millions) — drives cheque fit"}</div>
              <div className="mt-1 flex items-center gap-2">
                <input type="number" min={0} step={0.05} className={`${input} w-28`} value={m[k].min / 1e6} aria-label={`${k} min`} onChange={(e) => setM({ [k]: { ...m[k], min: Math.round(Number(e.target.value) * 1e6) } })} />
                to
                <input type="number" min={0} step={0.05} className={`${input} w-28`} value={m[k].max / 1e6} aria-label={`${k} max`} onChange={(e) => setM({ [k]: { ...m[k], max: Math.round(Number(e.target.value) * 1e6) } })} />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Geographies">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <label>
            Primary cities (comma-separated)
            <ListInput className="mt-1 w-full" value={m.geographies_primary} onChange={(v) => setM({ geographies_primary: v })} />
          </label>
          <label>
            Secondary cities
            <ListInput className="mt-1 w-full" value={m.geographies_secondary} onChange={(v) => setM({ geographies_secondary: v })} />
          </label>
        </div>
      </Section>

      <Section title="Tune weights" hint={`Points per component; the base components currently sum to ${baseTotal}. Overrides add on top; the display score is clamped to 0–100.`}>
        <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {[...BASE_WEIGHTS, ...OVERRIDES].map((k) => (
            <label key={k} className="grid grid-cols-[10rem_1fr_2.5rem] items-center gap-2">
              <span className="capitalize">{OVERRIDES.includes(k as (typeof OVERRIDES)[number]) ? `+ ${label(k)}` : label(k)}</span>
              <input type="range" min={0} max={40} step={1} value={cfg.scoring_weights[k]} onChange={(e) => set({ scoring_weights: { ...cfg.scoring_weights, [k]: Number(e.target.value) } })} />
              <span className="text-right tabular-nums">{cfg.scoring_weights[k]}</span>
            </label>
          ))}
          <label className="grid grid-cols-[10rem_1fr_2.5rem] items-center gap-2">
            <span>× single-source discount</span>
            <input type="range" min={0.5} max={1} step={0.05} value={cfg.scoring_weights.confidence_discount_single_source} onChange={(e) => set({ scoring_weights: { ...cfg.scoring_weights, confidence_discount_single_source: Number(e.target.value) } })} />
            <span className="text-right tabular-nums">{cfg.scoring_weights.confidence_discount_single_source.toFixed(2)}</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          {(["act_now", "high", "relevant", "context"] as const).map((t) => (
            <label key={t} className="flex items-center gap-1">
              {t.replace("_", " ")} ≥
              <input type="number" className={`${input} w-16`} value={cfg.tier_thresholds[t]} onChange={(e) => set({ tier_thresholds: { ...cfg.tier_thresholds, [t]: Number(e.target.value) } })} />
            </label>
          ))}
        </div>
      </Section>

      <Section title="Delivery" hint={digestToOverride ? "Note: the DIGEST_TO environment variable currently overrides these recipients for every send (test sender restriction)." : undefined}>
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <label>
            Cadence
            <select className={`${input} mt-1 w-full`} value={cfg.delivery.mode} onChange={(e) => set({ delivery: { ...cfg.delivery, mode: e.target.value as MandateConfig["delivery"]["mode"] } })}>
              <option value="weekly">weekly</option>
              <option value="twice_weekly">twice weekly</option>
              <option value="daily">daily</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <label>
            Send at (local)
            <input className={`${input} mt-1 w-full`} value={cfg.delivery.send_hour} pattern="\d{2}:\d{2}" onChange={(e) => set({ delivery: { ...cfg.delivery, send_hour: e.target.value } })} />
          </label>
          <label>
            Time zone
            <input className={`${input} mt-1 w-full`} value={cfg.delivery.timezone} onChange={(e) => set({ delivery: { ...cfg.delivery, timezone: e.target.value } })} />
          </label>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          {DAYS.map((d) => (
            <label key={d} className="flex items-center gap-1 capitalize">
              <input type="checkbox" checked={cfg.delivery.days.includes(d)} onChange={() => set({ delivery: { ...cfg.delivery, days: toggle(cfg.delivery.days, d) } })} /> {d.slice(0, 3)}
            </label>
          ))}
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <label>
            Recipients (comma-separated emails)
            <ListInput className="mt-1 w-full" value={cfg.delivery.recipients} onChange={(v) => set({ delivery: { ...cfg.delivery, recipients: v } })} />
          </label>
          <label>
            Minimum deals to send
            <input type="number" min={0} className={`${input} mt-1 w-full`} value={cfg.delivery.min_deals_to_send} onChange={(e) => set({ delivery: { ...cfg.delivery, min_deals_to_send: Number(e.target.value) } })} />
          </label>
        </div>
      </Section>

      <Section title="Alerts" hint="Alert delivery arrives in M9; thresholds are stored now and read by the alerts engine.">
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={cfg.alerts.enabled} onChange={(e) => set({ alerts: { ...cfg.alerts, enabled: e.target.checked } })} /> Alerts enabled
          </label>
          <label>
            Minimum severity
            <select className={`${input} mt-1 w-full`} value={cfg.alerts.severity_threshold} onChange={(e) => set({ alerts: { ...cfg.alerts, severity_threshold: e.target.value as MandateConfig["alerts"]["severity_threshold"] } })}>
              {["critical", "high", "medium", "info"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Max immediate alerts / day
            <input type="number" min={0} className={`${input} mt-1 w-full`} value={cfg.alerts.max_immediate_per_day} onChange={(e) => set({ alerts: { ...cfg.alerts, max_immediate_per_day: Number(e.target.value) } })} />
          </label>
          <label>
            Quiet hours from
            <input className={`${input} mt-1 w-full`} value={cfg.alerts.quiet_hours[0]} onChange={(e) => set({ alerts: { ...cfg.alerts, quiet_hours: [e.target.value, cfg.alerts.quiet_hours[1]] } })} />
          </label>
          <label>
            Quiet hours to
            <input className={`${input} mt-1 w-full`} value={cfg.alerts.quiet_hours[1]} onChange={(e) => set({ alerts: { ...cfg.alerts, quiet_hours: [cfg.alerts.quiet_hours[0], e.target.value] } })} />
          </label>
          <label>
            Cluster: ≥ N adjacent raises in D days
            <span className="mt-1 flex gap-2">
              <input type="number" min={1} className={`${input} w-16`} aria-label="Cluster threshold" value={cfg.alerts.cluster_threshold} onChange={(e) => set({ alerts: { ...cfg.alerts, cluster_threshold: Number(e.target.value) } })} />
              <input type="number" min={1} className={`${input} w-20`} aria-label="Cluster window days" value={cfg.alerts.cluster_window_days} onChange={(e) => set({ alerts: { ...cfg.alerts, cluster_window_days: Number(e.target.value) } })} />
            </span>
          </label>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          {triggerKeys.map((k) => (
            <label key={k} className="flex items-center gap-1">
              <input type="checkbox" checked={cfg.alerts.triggers_enabled[k] ?? false} onChange={(e) => set({ alerts: { ...cfg.alerts, triggers_enabled: { ...cfg.alerts.triggers_enabled, [k]: e.target.checked } } })} /> {k.replace(/_/g, " ")}
            </label>
          ))}
        </div>
      </Section>

      <div className="no-print sticky bottom-0 flex flex-wrap items-start justify-between gap-3 border-t border-line bg-background/95 py-3 backdrop-blur">
        <div className="text-sm">
          {status.kind === "ok" ? <span className="text-up">{status.msg}</span> : null}
          {status.kind === "error" ? (
            <div className="text-down">
              {status.msg}
              {status.issues?.length ? (
                <ul className="list-disc pl-4 text-xs">
                  {status.issues.map((i, n) => (
                    <li key={n}>
                      {i.path}: {i.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-start gap-2">
          <button type="button" className="rounded-md border border-line px-3 py-1.5 text-sm" onClick={() => {
              setCfg(initial);
              setRev((r) => r + 1);
            }}>
            Discard changes
          </button>
          <button type="button" onClick={save} disabled={status.kind === "saving"} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">
            {status.kind === "saving" ? "Saving…" : "Save mandate"}
          </button>
          {status.kind === "ok" ? <RegenerateButton profileId={profileId} mode={cfg.delivery.mode === "daily" ? "daily" : "weekly"} /> : null}
        </div>
      </div>
    </div>
  );
}
