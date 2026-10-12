"use client";

import { useState } from "react";
import { adminFetch } from "@/components/admin";

/** Submit a real article URL the feeds missed (POST /api/manual-deal). */
export function ManualDealForm() {
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        try {
          const res = await adminFetch("/api/manual-deal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
          const body = (await res.json()) as { ok: boolean; note?: string; error?: string };
          setMsg({ ok: body.ok, text: body.ok ? (body.note ?? "Queued.") : (body.error ?? "Failed") });
          if (body.ok) setUrl("");
        } catch (err) {
          setMsg({ ok: false, text: err instanceof Error ? err.message : "Failed" });
        } finally {
          setBusy(false);
        }
      }}
    >
      <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… article announcing a round" aria-label="Article URL" className="input min-w-0 flex-1" />
      <button type="submit" disabled={busy} className="btn btn-primary btn-sm">
        {busy ? "Fetching…" : "Submit article"}
      </button>
      {msg ? <span className={`w-full text-xs ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</span> : null}
    </form>
  );
}
