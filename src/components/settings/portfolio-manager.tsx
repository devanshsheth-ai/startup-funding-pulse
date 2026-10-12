"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminFetch } from "@/components/admin";
import { STAGE_HELD_LABEL } from "@/lib/copy";
import { keywordProblems } from "@/lib/settings-schemas";

/**
 * Tracked-company (simulated portfolio) management (PRD §18.8) with inline
 * guidance that adjacency keywords must be specific (CLAUDE.md §7.6).
 */

export interface TrackedView {
  id: number;
  name: string;
  description: string;
  sector: string;
  subSector: string | null;
  stageHeld: string | null;
  city: string | null;
  keywords: string[];
}

interface Draft {
  id?: number;
  name: string;
  description: string;
  sector: string;
  sub_sector: string;
  stage_held: string;
  city: string;
  keywords: string;
}

const input = "input";
const empty = (sector: string): Draft => ({ name: "", description: "", sector, sub_sector: "", stage_held: "", city: "", keywords: "" });
const toDraft = (t: TrackedView): Draft => ({ id: t.id, name: t.name, description: t.description, sector: t.sector, sub_sector: t.subSector ?? "", stage_held: t.stageHeld ?? "", city: t.city ?? "", keywords: t.keywords.join(", ") });
const kw = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function PortfolioManager({ profileId, tracked, sectors, stages }: { profileId: string; tracked: TrackedView[]; sectors: string[]; stages: string[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const problems = draft ? keywordProblems(kw(draft.keywords)) : [];
  const count = draft ? kw(draft.keywords).length : 0;

  async function save() {
    if (!draft) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await adminFetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: draft.id,
          profile: profileId,
          name: draft.name,
          description: draft.description,
          sector: draft.sector,
          sub_sector: draft.sub_sector.trim() || null,
          stage_held: draft.stage_held || null,
          city: draft.city.trim() || null,
          adjacency_keywords: kw(draft.keywords),
        }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string; reembed?: boolean; issues?: { path: string; message: string }[] };
      if (!body.ok) setMsg({ ok: false, text: body.issues?.map((i) => i.message).join("; ") || body.error || "Save failed" });
      else {
        setMsg({ ok: true, text: `Saved ${draft.name}.${body.reembed ? " Adjacency will be recomputed on the next rescore (Regenerate on the dashboard)." : ""}` });
        setDraft(null);
        router.refresh();
      }
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: TrackedView) {
    if (!window.confirm(`Stop tracking ${t.name}? It is deactivated, not deleted.`)) return;
    setBusy(true);
    try {
      const res = await adminFetch(`/api/portfolio/${t.id}`, { method: "DELETE" });
      const body = (await res.json()) as { ok: boolean; error?: string };
      setMsg(body.ok ? { ok: true, text: `${t.name} is no longer tracked.` } : { ok: false, text: body.error ?? "Remove failed" });
      if (body.ok) router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Remove failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {msg ? <p className={`text-sm ${msg.ok ? "text-up" : "text-down"}`} role="status">{msg.text}</p> : null}
      <ul className="card divide-y divide-line overflow-hidden">
        {tracked.map((t) => (
          <li key={t.id} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {t.name} <span className="text-xs font-normal text-muted">· {t.sector}{t.subSector ? ` · ${t.subSector}` : ""} · {STAGE_HELD_LABEL}: {t.stageHeld ?? "—"}</span>
              </div>
              <div className="text-xs text-muted">{t.description}</div>
              <div className="mt-1 text-xs">Keywords: {t.keywords.join(" · ")}</div>
            </div>
            <div className="flex gap-1">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDraft(toDraft(t))}>
                Edit
              </button>
              <button type="button" className="btn btn-secondary btn-sm !text-down" disabled={busy} onClick={() => remove(t)}>
                Stop tracking
              </button>
            </div>
          </li>
        ))}
        {tracked.length === 0 ? <li className="p-3 text-sm text-muted">No tracked companies.</li> : null}
      </ul>

      {draft ? (
        <div className="space-y-2 rounded-lg border border-accent bg-card p-4 text-sm">
          <h3 className="font-semibold">{draft.id ? `Edit ${draft.name}` : "Track a company"}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <label>
              Name
              <input className={input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label>
              City
              <input className={input} value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
            </label>
            <label>
              Sector
              <select className={input} value={draft.sector} onChange={(e) => setDraft({ ...draft, sector: e.target.value })}>
                {sectors.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Sub-sector
              <input className={input} value={draft.sub_sector} onChange={(e) => setDraft({ ...draft, sub_sector: e.target.value })} />
            </label>
            <label>
              {STAGE_HELD_LABEL}
              <select className={input} value={draft.stage_held} onChange={(e) => setDraft({ ...draft, stage_held: e.target.value })}>
                <option value="">—</option>
                {stages.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            Description (what it sells, to whom) — embedded for the adjacency shortlist
            <textarea className={`${input} h-16`} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>
          <label className="block">
            Adjacency keywords (comma-separated)
            <input className={input} value={draft.keywords} onChange={(e) => setDraft({ ...draft, keywords: e.target.value })} placeholder="e.g. embedded finance, BNPL for B2B, invoice discounting" />
          </label>
          <p className="text-xs text-muted">
            Use 6–8 <strong>specific</strong> phrases naming the product, customer or business model (“embedded finance”, “BNPL B2B”), never a bare sector (“fintech”) — generic
            keywords match everything and flood the adjacency section. {count ? `${count} entered.` : ""}
          </p>
          {problems.length ? (
            <ul className="list-disc pl-4 text-xs text-down">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : count > 0 && count < 6 ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">Fewer than 6 keywords: adjacency recall may be low.</p>
          ) : null}
          <div className="flex gap-2">
            <button type="button" disabled={busy || problems.length > 0 || count < 3} onClick={save} className="btn btn-primary btn-sm">
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDraft(empty(sectors[0] ?? "Fintech"))}>
          + Track a company
        </button>
      )}
    </div>
  );
}
