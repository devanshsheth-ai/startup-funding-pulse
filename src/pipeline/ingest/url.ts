import { createHash } from "node:crypto";

/**
 * Article identity (PRD §9.2): sha256 of the normalised URL. Never the feed
 * guid — some feeds emit a constant guid for every item, which would collapse
 * the whole feed into one row.
 */

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref",
  "ref_src",
  "cmpid",
  "from",
  "ito",
  "_ga",
]);

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith("utm_") || TRACKING_PARAMS.has(k);
}

export function normalizeUrl(raw: string): string {
  const url = new URL(raw.trim());
  url.protocol = url.protocol.toLowerCase();
  if (url.protocol === "http:") url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  if ((url.protocol === "https:" && url.port === "443") || url.port === "80") url.port = "";

  const kept = [...url.searchParams.entries()]
    .filter(([k]) => !isTrackingParam(k))
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [k, v] of kept) url.searchParams.append(k, v);

  let path = url.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  url.pathname = path;

  return url.toString();
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function urlHash(raw: string): string {
  return sha256(normalizeUrl(raw));
}

/** Resolve a possibly-relative link against the page it appeared on. */
export function absoluteUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}
