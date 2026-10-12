"use client";

import { useEffect, useState } from "react";

/**
 * Light / dark switch. Light is the default; the pre-paint script in the
 * root layout applies a stored "dark" before first render, so there is no
 * flash. The choice is remembered in localStorage (per browser).
 */
const KEY = "fp_theme";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    // The class is only readable after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  return (
    <button
      type="button"
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.classList.toggle("dark", next);
        try {
          if (next) localStorage.setItem(KEY, "dark");
          else localStorage.removeItem(KEY);
        } catch {
          /* storage blocked: applies to this page only */
        }
      }}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className="no-print grid h-9 w-9 shrink-0 place-items-center rounded-full border-[1.5px] border-foreground/80 text-foreground transition-all hover:bg-foreground hover:text-background"
    >
      {dark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
