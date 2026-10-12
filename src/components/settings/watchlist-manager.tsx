"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminFetch } from "@/components/admin";
import { parseCsv } from "@/lib/format";
import { WATCH_STATUSES, WATCH_TYPES, watchItemFromCsv, type WatchItem } from "@/lib/settings-schemas";

/**
 * Watchlist management (PRD §18.8): add with Gemini alias suggestions the user
 * confirms, bulk paste, CSV import/export, inline edit of notes, tags, status
 * and alerts, soft remove, and a "Suggested to watch" panel.
 */

export interface WatchRowView {
  id: number;
  type: string;
  value: string;
  aliases: string[];
  notes: string | null;
  tags: string[];
  alertsEnabled: boolean;
  status: string;
  lastEvent: string | null;
}

type Suggestion = { company: string; score: number; stage: string; sector: string };
const input = "input";
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function toItem(r: WatchRowView): WatchItem {
  return {
    id: r.id,
    watch_type: r.type as WatchItem["watch_type"],
    value: r.value,
    aliases: r.aliases,
    notes: r.notes,
    tags: r.tags,
    alerts_enabled: r.alertsEnabled,
    status: (WATCH_STATUSES as readonly string[]).includes(r.status) ? (r.status as WatchItem["status"]) : "watching",
  };
}

export function WatchlistManager({ profileId, rows, suggestions }: { profileId: string; rows: WatchRowView[]; suggestions: Suggestion[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<WatchItem["watch_type"]>("company");
  const [value, setValue] = useState("");
  const [aliasSuggestions, setAliasSuggestions] = useState<{ name: string; reason: string; on: boolean }[]>([]);
  const [bulk, setBulk] = useState("");
  const [editing, setEditing] = useState<(WatchItem & { aliasesText: string; tagsText: string; notesText: string }) | null>(null);
  const startEdit = (r: WatchRowView) => {
    const it = toItem(r);
    setEditing({ ...it, aliasesText: it.aliases.join(", "), tagsText: it.tags.join(", "), notesText: it.notes ?? "" });
  };
  async function saveEdit() {
    if (!editing) return;
    const { aliasesText, tagsText, notesText, ...rest } = editing;
    const ok = await send([{ ...rest, aliases: list(aliasesText), tags: list(tagsText), notes: notesText.trim() || null }], `Updated ${editing.value}`);
    if (ok) setEditing(null);
  }

  async function send(items: WatchItem[], okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await adminFetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: profileId, items }) });
      const body = (await res.json()) as { ok: boolean; saved?: number; rejected?: { value: string; reason: string }[]; error?: string; issues?: { path: string; message: string }[] };
      if (!body.ok) setMsg({ ok: false, text: body.issues?.map((i) => `${i.path}: ${i.message}`).join("; ") || body.error || "Save failed" });
      else {
        const rej = body.rejected ?? [];
        setMsg({ ok: rej.length === 0, text: `${okText}: ${body.saved ?? 0} saved${rej.length ? `; skipped ${rej.map((r) => `${r.value} (${r.reason})`).join(", ")}` : ""}.` });
        router.refresh();
      }
      return body.ok;
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Save failed" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function suggestAliases() {
    if (!value.trim()) return;
    setBusy(true);
    try {
      const res = await adminFetch("/api/watchlist/aliases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ watch_type: type, value }) });
      const body = (await res.json()) as { ok: boolean; aliases?: { name: string; reason: string }[]; error?: string };
      setAliasSuggestions((body.aliases ?? []).map((a) => ({ ...a, on: false })));
      if (!body.ok) setMsg({ ok: false, text: body.error ?? "No suggestions" });
      else if (!body.aliases?.length) setMsg({ ok: true, text: "No confident aliases suggested." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Suggestion failed" });
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const aliases = aliasSuggestions.filter((a) => a.on).map((a) => a.name);
    const ok = await send([{ watch_type: type, value: value.trim(), aliases, notes: null, tags: [], alerts_enabled: true, status: "watching" }], `Added ${value.trim()}`);
    if (ok) {
      setValue("");
      setAliasSuggestions([]);
    }
  }

  async function remove(r: WatchRowView) {
    if (!window.confirm(`Stop watching ${r.value}? (It is kept as removed and can be re-added.)`)) return;
    setBusy(true);
    try {
      const res = await adminFetch(`/api/watchlist/${r.id}`, { method: "DELETE" });
      const body = (await res.json()) as { ok: boolean; error?: string };
      setMsg(body.ok ? { ok: true, text: `Removed ${r.value}.` } : { ok: false, text: body.error ?? "Remove failed" });
      if (body.ok) router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Remove failed" });
    } finally {
      setBusy(false);
    }
  }

  async function importCsv(file: File) {
    const rowsCsv = parseCsv(await file.text());
    const header = (rowsCsv[0] ?? []).map((h) => h.trim().toLowerCase());
    if (!header.includes("value")) return setMsg({ ok: false, text: "The CSV needs a header row with at least a 'value' column (export one to see the format)." });
    const items: WatchItem[] = [];
    const errors: string[] = [];
    rowsCsv.slice(1).forEach((cells, i) => {
      const r = watchItemFromCsv(cells, header);
      if (r.item) items.push(r.item);
      else errors.push(`row ${i + 2}: ${r.error}`);
    });
    if (items.length === 0) return setMsg({ ok: false, text: `Nothing to import. ${errors.slice(0, 3).join("; ")}` });
    await send(items, `Imported ${file.name}${errors.length ? ` (${errors.length} invalid rows skipped: ${errors.slice(0, 2).join("; ")})` : ""}`);
  }

  return (
    <div className="space-y-4">
      {msg ? <p className={`text-sm ${msg.ok ? "text-up" : "text-down"}`} role="status">{msg.text}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3 p-5">
          <h3 className="text-sm font-semibold">Add one</h3>
          <div className="flex flex-wrap gap-2">
            <select className={input} value={type} onChange={(e) => setType(e.target.value as WatchItem["watch_type"])} aria-label="Watch type">
              {WATCH_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <input className={`${input} min-w-0 flex-1`} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Name, sector or keyword" aria-label="Value" />
          </div>
          <div className="flex flex-wrap gap-2">
            {type === "company" || type === "investor" ? (
              <button type="button" disabled={busy || !value.trim()} onClick={suggestAliases} className="btn btn-secondary btn-sm">
                Suggest aliases
              </button>
            ) : null}
            <button type="button" disabled={busy || !value.trim()} onClick={add} className="btn btn-primary btn-sm">
              Add to watchlist
            </button>
          </div>
          {aliasSuggestions.length ? (
            <div className="text-sm">
              <p className="text-xs text-muted">Gemini suggestions; tick the ones that are the same entity:</p>
              {aliasSuggestions.map((a, i) => (
                <label key={a.name} className="flex items-center gap-2">
                  <input type="checkbox" checked={a.on} onChange={() => setAliasSuggestions((xs) => xs.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} />
                  {a.name} <span className="text-xs text-muted">({a.reason})</span>
                </label>
              ))}
            </div>
          ) : null}
        </div>

        <div className="card space-y-3 p-5">
          <h3 className="text-sm font-semibold">Bulk paste and CSV</h3>
          <textarea className={`${input} h-20 w-full`} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={"One per line, added as the type selected on the left\nRazorpay\nZepto"} aria-label="Bulk paste" />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || !bulk.trim()}
              className="btn btn-primary btn-sm"
              onClick={async () => {
                const lines = [...new Set(bulk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];
                if (await send(lines.map((v) => ({ watch_type: type, value: v, aliases: [], notes: null, tags: [], alerts_enabled: true, status: "watching" })), `Added ${lines.length} ${type} entries`)) setBulk("");
              }}
            >
              Add {bulk.split(/\r?\n/).filter((l) => l.trim()).length || ""} as {type}
            </button>
            <label className="btn btn-secondary btn-sm">
              Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importCsv(f);
                  e.target.value = "";
                }}
              />
            </label>
            <a className="btn btn-secondary btn-sm" href={`/api/export/watchlist.csv?profile=${profileId}`}>
              Export CSV
            </a>
          </div>
          <p className="text-xs text-muted">CSV columns: watch_type, value, aliases (a|b), notes, tags (a|b), alerts_enabled, status. The export re-imports unchanged.</p>
        </div>
      </div>

      <div className="card overflow-x-auto p-2">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              {["Type", "Value", "Aliases", "Tags", "Status", "Alerts", "Last event", "Notes", ""].map((h) => (
                <th key={h} className="px-2 py-1.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) =>
              editing?.id === r.id ? (
                <tr key={r.id} className="border-b border-line/60 bg-black/[0.03] align-top dark:bg-white/[0.04]">
                  <td className="px-2 py-1.5 text-xs text-muted">{r.type}</td>
                  <td className="px-2 py-1.5">{r.value}</td>
                  <td className="px-2 py-1.5">
                    <input className={`${input} w-40`} value={editing.aliasesText} onChange={(e) => setEditing({ ...editing, aliasesText: e.target.value })} aria-label="Aliases" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input className={`${input} w-28`} value={editing.tagsText} onChange={(e) => setEditing({ ...editing, tagsText: e.target.value })} aria-label="Tags" />
                  </td>
                  <td className="px-2 py-1.5">
                    <select className={input} value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as WatchItem["status"] })} aria-label="Status">
                      {WATCH_STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={editing.alerts_enabled} onChange={(e) => setEditing({ ...editing, alerts_enabled: e.target.checked })} aria-label="Alerts enabled" />
                  </td>
                  <td className="px-2 py-1.5 text-xs">{r.lastEvent ?? "—"}</td>
                  <td className="px-2 py-1.5">
                    <input className={`${input} w-44`} value={editing.notesText} onChange={(e) => setEditing({ ...editing, notesText: e.target.value })} aria-label="Notes" />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <button type="button" className="btn btn-primary btn-sm mr-1" disabled={busy} onClick={saveEdit}>
                      Save
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={r.id} className="border-b border-line/60 align-top">
                  <td className="px-2 py-1.5 text-xs text-muted">{r.type}</td>
                  <td className="px-2 py-1.5">{r.value}</td>
                  <td className="px-2 py-1.5 text-xs text-muted">{r.aliases.join(", ")}</td>
                  <td className="px-2 py-1.5 text-xs text-muted">{r.tags.map((t) => `#${t}`).join(" ")}</td>
                  <td className="px-2 py-1.5 text-xs">{r.status}</td>
                  <td className="px-2 py-1.5 text-xs">{r.alertsEnabled ? "on" : "off"}</td>
                  <td className="px-2 py-1.5 text-xs">{r.lastEvent ?? "—"}</td>
                  <td className="px-2 py-1.5 text-xs text-muted">{r.notes ?? ""}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <button type="button" className="btn btn-secondary btn-sm mr-1" onClick={() => startEdit(r)}>
                      Edit
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm !text-down" disabled={busy} onClick={() => remove(r)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-5">
        <h3 className="mb-2 text-sm font-semibold">Suggested to watch</h3>
        <p className="mb-2 text-xs text-muted">Companies in act-now or high-tier deals for this profile in the last 90 days that you are not watching or tracking.</p>
        {suggestions.length === 0 ? (
          <p className="text-sm text-muted">No suggestions right now.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <li key={s.company} className="flex items-center gap-2 rounded-xl border border-line bg-card px-2.5 py-1.5 text-sm shadow-sm">
                <span>
                  {s.company} <span className="text-xs text-muted">· {s.stage} · {s.sector} · score {Math.round(s.score)}</span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  className="btn btn-primary btn-sm !py-0.5"
                  onClick={() => send([{ watch_type: "company", value: s.company, aliases: [], notes: `Suggested from a ${s.stage} deal (score ${Math.round(s.score)})`, tags: ["suggested"], alerts_enabled: true, status: "watching" }], `Watching ${s.company}`)}
                >
                  + Watch
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
