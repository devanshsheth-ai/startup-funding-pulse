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

export function RegenerateButton({ profileId, mode }: { profileId: string; mode: "weekly" | "daily" }) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; msg: string | null; link: string | null; error: boolean }>({ busy: false, msg: null, link: null, error: false });
  async function run() {
    setState({ busy: true, msg: "Rescoring against the current mandate, then writing the brief (up to ~1 min)…", link: null, error: false });
    try {
      const res = await adminFetch(`/api/profile/${profileId}/regenerate?mode=${mode}`, { method: "POST" });
      const body = (await res.json()) as { ok: boolean; scored?: number; shareUrl?: string | null; error?: string; reason?: string };
      if (!body.ok) {
        setState({ busy: false, msg: body.error ?? body.reason ?? "Regenerate failed.", link: null, error: true });
        return;
      }
      setState({ busy: false, msg: `Rescored ${body.scored ?? 0} deals and generated a new brief.`, link: body.shareUrl ?? null, error: false });
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
        className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-60"
      >
        {state.busy ? "Regenerating…" : "Regenerate brief"}
      </button>
      {state.msg ? (
        <p className={`max-w-xs text-right text-xs ${state.error ? "text-down" : "text-muted"}`} role="status">
          {state.msg}{" "}
          {state.link ? (
            <a className="link" href={state.link} target="_blank" rel="noopener noreferrer">
              Open brief ↗
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
