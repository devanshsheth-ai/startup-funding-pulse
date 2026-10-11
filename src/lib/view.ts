import { mandateConfigSchema, type MandateConfig } from "@/config/profile";
import { getDb } from "@/db/client";
import { profiles } from "@/db/schema";
import { toIsoDate } from "@/pipeline/normalize";

/**
 * Resolves the profile and time window a web page renders for, from the URL.
 * Every page takes `?profile=` (switcher) and most take `?window=`; the
 * default window is the profile's digest window, last_digest_sent_at → now,
 * so the dashboard shows exactly what the next brief will cover.
 */

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function param(sp: Record<string, string | string[] | undefined>, key: string): string | null {
  const v = sp[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

export interface ViewProfile {
  id: string;
  displayName: string;
  config: MandateConfig;
  lastDigestSentAt: Date | null;
}

export async function loadViewProfiles(): Promise<ViewProfile[]> {
  const rows = await getDb()
    .select({ id: profiles.id, displayName: profiles.displayName, config: profiles.config, isDefault: profiles.isDefault, lastDigestSentAt: profiles.lastDigestSentAt })
    .from(profiles);
  rows.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.id.localeCompare(b.id));
  return rows.map((r) => ({ id: r.id, displayName: r.displayName, config: mandateConfigSchema.parse(r.config), lastDigestSentAt: r.lastDigestSentAt }));
}

export async function resolveProfile(id: string | null): Promise<{ all: ViewProfile[]; active: ViewProfile | null }> {
  const all = await loadViewProfiles();
  return { all, active: (id ? all.find((p) => p.id === id) : all[0]) ?? null };
}

export const WINDOW_OPTIONS = [
  { key: "digest", label: "Since last brief" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
] as const;
export type WindowKey = (typeof WINDOW_OPTIONS)[number]["key"];

export interface ViewWindow {
  key: WindowKey;
  label: string;
  start: string;
  end: string;
  days: number;
}

const DAY = 86_400_000;

export function resolveWindow(key: string | null, profile: ViewProfile | null, now: Date): ViewWindow {
  const k = (WINDOW_OPTIONS.find((o) => o.key === key)?.key ?? "digest") as WindowKey;
  const label = WINDOW_OPTIONS.find((o) => o.key === k)?.label ?? "";
  let start: Date;
  if (k === "digest") start = profile?.lastDigestSentAt ?? new Date(now.getTime() - 7 * DAY);
  else start = new Date(now.getTime() - (Number(k.replace("d", "")) - 1) * DAY);
  const s = toIsoDate(start);
  const e = toIsoDate(now);
  const days = Math.max(1, Math.round((Date.parse(`${e}T00:00:00Z`) - Date.parse(`${s}T00:00:00Z`)) / DAY) + 1);
  return { key: k, label, start: s, end: e, days };
}

/** Build a same-page href that keeps the other query params. */
export function hrefWith(path: string, sp: Record<string, string | string[] | undefined>, patch: Record<string, string | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) u.set(k, v);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) u.delete(k);
    else u.set(k, v);
  }
  const qs = u.toString();
  return qs ? `${path}?${qs}` : path;
}
