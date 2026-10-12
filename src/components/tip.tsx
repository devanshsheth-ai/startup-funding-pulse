import type { ReactNode } from "react";

/**
 * Hover/focus explanation for any element (CSS-only). Use for short "what
 * does this mean" text on badges, numbers, pills and labels.
 */
export function Tip({ text, children, side = "top", block = false, className = "" }: { text: ReactNode; children: ReactNode; side?: "top" | "bottom"; block?: boolean; className?: string }) {
  return (
    <span className={`group/tip relative ${block ? "flex w-full flex-col" : "inline-flex"} ${className}`} tabIndex={0}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none invisible absolute left-1/2 z-40 w-max max-w-[17rem] -translate-x-1/2 rounded-xl bg-slate-900 px-3 py-2 text-left text-[11.5px] font-medium leading-snug text-white opacity-0 shadow-xl transition-all duration-150 group-hover/tip:visible group-hover/tip:opacity-100 group-focus/tip:visible group-focus/tip:opacity-100 dark:bg-slate-700 ${
          side === "top" ? "bottom-full mb-2" : "top-full mt-2"
        }`}
      >
        {text}
      </span>
    </span>
  );
}
