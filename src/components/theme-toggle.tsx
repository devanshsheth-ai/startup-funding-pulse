"use client";

import { useEffect, useState } from "react";

/**
 * Light / dark / system toggle. The pre-paint script in the root layout
 * applies the stored choice before first render, so there is no flash; this
 * control only changes and remembers it (localStorage, per browser).
 */
type Theme = "system" | "light" | "dark";
const KEY = "fp_theme";
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Theme, string> = { system: "◐ Auto", light: "☀ Light", dark: "☾ Dark" };

function apply(t: Theme) {
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    let stored: Theme = "system";
    try {
      const v = localStorage.getItem(KEY);
      if (v === "light" || v === "dark") stored = v;
    } catch {
      /* storage blocked: follow the system */
    }
    // localStorage is only readable after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(stored);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      let cur: string | null = null;
      try {
        cur = localStorage.getItem(KEY);
      } catch {
        /* ignore */
      }
      if (cur !== "light" && cur !== "dark") apply("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return (
    <button
      type="button"
      className="no-print rounded-md px-2 py-1 text-xs text-muted hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
      aria-label={`Theme: ${theme}. Click to change.`}
      onClick={() => {
        const next = NEXT[theme];
        setTheme(next);
        try {
          if (next === "system") localStorage.removeItem(KEY);
          else localStorage.setItem(KEY, next);
        } catch {
          /* storage blocked: applies for this page only */
        }
        apply(next);
      }}
    >
      {LABEL[theme]}
    </button>
  );
}
