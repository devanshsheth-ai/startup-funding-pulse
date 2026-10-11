"use client";

import { useEffect, useState } from "react";
import { forgetAdminSecret, hasAdminSecret, setAdminSecret } from "@/components/admin";

/** Unlock/lock control for settings: the secret lives in sessionStorage for this tab only. */
export function AdminBar() {
  const [unlocked, setUnlocked] = useState(false);
  const [value, setValue] = useState("");
  useEffect(() => {
    // sessionStorage is only readable after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUnlocked(hasAdminSecret());
  }, []);
  return (
    <div className="no-print flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card p-3 text-sm">
      {unlocked ? (
        <>
          <span>🔓 Changes enabled for this tab.</span>
          <button
            type="button"
            className="rounded-md border border-line px-2 py-0.5"
            onClick={() => {
              forgetAdminSecret();
              setUnlocked(false);
            }}
          >
            Lock
          </button>
        </>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!value.trim()) return;
            setAdminSecret(value.trim());
            setValue("");
            setUnlocked(true);
          }}
        >
          <span>🔒 Viewing is public; saving changes needs the admin secret.</span>
          <input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="ADMIN_SECRET" aria-label="Admin secret" autoComplete="off" className="rounded-md border border-line bg-background px-2 py-0.5" />
          <button type="submit" className="rounded-md bg-foreground px-2 py-0.5 text-background">
            Unlock
          </button>
        </form>
      )}
    </div>
  );
}
