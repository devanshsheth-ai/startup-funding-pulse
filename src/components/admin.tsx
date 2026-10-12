"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Client helpers for mutating endpoints. Every mutation needs ADMIN_SECRET
 * (CLAUDE.md §6). The secret is asked for once and kept in sessionStorage for
 * the tab, sent as `x-admin-secret`, and dropped on a 401.
 */

const KEY = "fp_admin_secret";

function readSecret(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetAdminSecret(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked: nothing to forget */
  }
}

export function hasAdminSecret(): boolean {
  return !!readSecret();
}

export function setAdminSecret(v: string): void {
  try {
    sessionStorage.setItem(KEY, v);
  } catch {
    /* storage blocked: the secret will be asked for again */
  }
}

export class AdminError extends Error {}

export async function adminFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let secret = readSecret();
  if (!secret) {
    secret = window.prompt("Admin secret (ADMIN_SECRET) — required for changes")?.trim() || null;
    if (!secret) throw new AdminError("An admin secret is required for this action.");
    setAdminSecret(secret);
  }
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), "x-admin-secret": secret } });
  if (res.status === 401) {
    forgetAdminSecret();
    throw new AdminError("The admin secret was not accepted.");
  }
  return res;
}

export function RegenerateButton({ profileId, mode, variant = "primary" }: { profileId: string; mode: "weekly" | "daily"; variant?: "primary" | "light" | "outline" }) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; msg: string | null; link: string | null; error: boolean }>({ busy: false, msg: null, link: null, error: false });
  async function run() {
    setState({ busy: true, msg: "Rescoring against the current mandate, then writing the brief (up to ~1 min)…", link: null, error: false });
    try {
      const res = await adminFetch(`/api/profile/${profileId}/regenerate?mode=${mode}`, { method: "POST" });
      const body = (await res.json()) as { ok: boolean; scored?: number; digestId?: number | null; error?: string; reason?: string };
      if (!body.ok) {
        setState({ busy: false, msg: body.error ?? body.reason ?? "Regenerate failed.", link: null, error: true });
        return;
      }
      setState({ busy: false, msg: `Rescored ${body.scored ?? 0} deals and generated a new brief.`, link: body.digestId ? `/brief?profile=${profileId}&id=${body.digestId}` : null, error: false });
      router.refresh();
    } catch (err) {
      setState({ busy: false, msg: err instanceof Error ? err.message : "Regenerate failed.", link: null, error: true });
    }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={state.busy}
        className={variant === "light" ? "btn bg-white text-indigo-700 shadow-lg shadow-indigo-900/20 hover:-translate-y-0.5 hover:bg-indigo-50" : variant === "outline" ? "btn btn-outline" : "btn btn-primary"}
      >
        {state.busy ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="animate-spin" aria-hidden>
            <path d="M21 12a9 9 0 1 1-6.2-8.6" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M3 21v-5h5" />
          </svg>
        )}
        {state.busy ? "Regenerating…" : "Regenerate brief"}
      </button>
      {state.msg ? (
        <p className={`max-w-xs text-right text-xs ${variant === "light" ? (state.error ? "font-semibold text-rose-100" : "text-white/85") : state.error ? "text-down" : "text-muted"}`} role="status">
          {state.msg}{" "}
          {state.link ? (
            <a className={variant === "light" ? "font-semibold text-white underline underline-offset-2" : "link"} href={state.link}>
              Open the new brief →
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
