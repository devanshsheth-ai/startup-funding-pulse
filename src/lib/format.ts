/** Display formatting shared by every web surface. Pure, no I/O. */

export function usd(n: number | null | undefined, opts: { undisclosed?: string } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return opts.undisclosed ?? "undisclosed";
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

export function pct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

/** Signed change with an arrow, e.g. "▲ 12%" / "▼ 3" / "— 0". */
export function delta(now: number, prev: number, mode: "pct" | "abs" = "pct"): { text: string; dir: "up" | "down" | "flat" } {
  const d = now - prev;
  const dir = d > 0 ? "up" : d < 0 ? "down" : "flat";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "—";
  if (mode === "abs") return { text: `${arrow} ${Math.abs(Math.round(d * 10) / 10)}`, dir };
  if (prev === 0) return { text: now === 0 ? "— 0%" : `${arrow} new`, dir };
  return { text: `${arrow} ${Math.abs(Math.round((100 * d) / prev))}%`, dir };
}

export const TIER_LABELS: Record<string, string> = {
  act_now: "🔴 Act now",
  high: "🟠 High",
  relevant: "🟡 Relevant",
  context: "⚪ Context",
  archive: "Archive",
};

/** One-line meaning of each relevance tier, for hover explanations (default thresholds; editable in Settings). */
export const TIER_HELP: Record<string, string> = {
  act_now: "Act now: scores 80+ (or forced up by a watchlist or adjacency override). Worth a look this week.",
  high: "High: scores 60–79. A strong fit with this mandate.",
  relevant: "Relevant: scores 40–59. A partial fit; worth a skim.",
  context: "Context: scores 20–39. Market background, not a mandate fit.",
  archive: "Archive: scores under 20, or removed by a hard filter such as an excluded sector.",
};

export const RELATIONSHIP_TEXT: Record<string, string> = {
  competitor: "Competitor",
  same_layer: "Same layer",
  supplier: "Supplier",
  customer: "Customer",
  complement: "Complement",
};

/** What each adjacency relationship means, for hover explanations. */
export const RELATIONSHIP_HELP: Record<string, string> = {
  competitor: "Competitor: the same product for the same customer. The most direct threat.",
  same_layer: "Same layer: a different product competing for the same budget or position in the stack.",
  supplier: "Supplier: sells something the tracked company buys or depends on.",
  customer: "Customer: could buy from the tracked company.",
  complement: "Complement: works alongside the tracked company; a possible partner.",
};

/** What each event type means, for hover explanations. */
export const EVENT_HELP: Record<string, string> = {
  ma: "M&A: an acquisition or merger, often an exit for the investors.",
  shutdown: "Shutdown: the company has closed or wound down.",
  ipo_filing: "IPO filing: draft papers filed for a public listing.",
  layoff: "Layoff: a reported reduction in staff.",
  people_move: "People move: a founder or senior executive joined or left.",
  fund_close: "Fund close: a VC fund raised new capital it will now invest.",
  financial_result: "Financial result: reported revenue or profit figures.",
};

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function slugify(s: string): string {
  return encodeURIComponent(s);
}

/** RFC 4180 CSV cell. Prefixes formula-leading characters so spreadsheets never execute a cell. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = Array.isArray(v) ? v.join("|") : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";
}

/** Minimal RFC 4180 parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}
