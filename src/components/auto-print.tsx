"use client";

import { useEffect, useState } from "react";

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

/** Copies the public read-only link (forwardable to LPs, PRD §18.10). */
export function CopyLinkButton({ url, className = "" }: { url: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy this link", url);
        }
      }}
    >
      {copied ? "Link copied ✓" : "Copy share link"}
    </button>
  );
}
