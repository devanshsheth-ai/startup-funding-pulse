import { render, toPlainText } from "@react-email/render";
import { createElement } from "react";
import type { DigestContent } from "@/pipeline/digest";
import { DailyDigest } from "./DailyDigest";
import { WeeklyDigest } from "./WeeklyDigest";

/** Gmail clips messages above ~102 KB, hiding the footer and disclosure (D-058). */
export const MAX_EMAIL_BYTES = 98 * 1024;

/** Shrink the long lists one step; returns null when nothing is left to trim. */
function trimmed(c: DigestContent, step: number): DigestContent | null {
  const cap = [10, 7, 5, 3][step];
  if (cap === undefined) return null;
  return {
    ...c,
    ranked: { ...c.ranked, act_now: c.ranked.act_now.slice(0, cap), high: c.ranked.high.slice(0, Math.max(0, cap - c.ranked.act_now.length)), relevant: [] },
    adjacency: c.adjacency.slice(0, Math.max(3, cap - 2)),
    patterns: c.patterns.map((p) => ({ ...p, evidence: p.evidence.slice(0, 3) })),
    sectorHeat: c.sectorHeat.slice(0, 8),
    heldAlerts: (c.heldAlerts ?? []).slice(0, cap),
  };
}

/** Render a digest to HTML plus its plain-text alternative (PRD §17). */
export async function renderDigest(c: DigestContent): Promise<{ html: string; text: string; subject: string; trimmedSteps: number }> {
  const draw = (x: DigestContent) => render(x.mode === "weekly" ? createElement(WeeklyDigest, { c: x }) : createElement(DailyDigest, { c: x }));
  let html = await draw(c);
  let steps = 0;
  while (Buffer.byteLength(html, "utf8") > MAX_EMAIL_BYTES) {
    const next = trimmed(c, steps);
    if (!next) break;
    html = await draw(next);
    steps++;
  }
  return { html, text: toPlainText(html), subject: c.headline, trimmedSteps: steps };
}
