"use client";

import { useEffect } from "react";

/** Opens the print dialog once the page has rendered (Save as PDF, PRD §23). */
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 900);
    return () => clearTimeout(t);
  }, []);
  return null;
}

export function PrintButton({ className = "" }: { className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      Save as PDF
    </button>
  );
}
