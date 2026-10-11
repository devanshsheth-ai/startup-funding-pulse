/**
 * Minimal robots.txt evaluation (RFC 9309): group selection by user-agent
 * token, longest-match Allow/Disallow with `*` and `$` wildcards, Allow wins
 * ties. Pure — fetching and caching live in http.ts.
 */

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelaySec: number | null;
}

export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelaySec: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === "allow" || field === "disallow") {
      lastWasAgent = false;
      if (!current) continue;
      // An empty Disallow means "allow everything" and contributes no rule.
      if (value === "") continue;
      current.rules.push({ allow: field === "allow", pattern: value });
    } else if (field === "crawl-delay") {
      lastWasAgent = false;
      const n = Number(value);
      if (current && Number.isFinite(n) && n >= 0) current.crawlDelaySec = n;
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

function selectGroups(groups: RobotsGroup[], userAgent: string): RobotsGroup[] {
  const ua = userAgent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && ua.includes(a)));
  if (specific.length > 0) return specific;
  return groups.filter((g) => g.agents.includes("*"));
}

/** `pathWithQuery` is the URL path plus search string, e.g. `/feed?x=1`. */
export function isAllowedByRobots(groups: RobotsGroup[], userAgent: string, pathWithQuery: string): boolean {
  const rules = selectGroups(groups, userAgent).flatMap((g) => g.rules);
  let best: RobotsRule | null = null;
  let bestLen = -1;
  for (const rule of rules) {
    if (!patternToRegex(rule.pattern).test(pathWithQuery)) continue;
    const len = rule.pattern.length;
    if (len > bestLen || (len === bestLen && rule.allow)) {
      best = rule;
      bestLen = len;
    }
  }
  return best ? best.allow : true;
}

/** The strictest Crawl-delay that applies to this agent, in seconds. */
export function crawlDelayFor(groups: RobotsGroup[], userAgent: string): number | null {
  const delays = selectGroups(groups, userAgent)
    .map((g) => g.crawlDelaySec)
    .filter((d): d is number => d !== null);
  return delays.length ? Math.max(...delays) : null;
}
