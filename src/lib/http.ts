import { getEnv } from "@/lib/env";
import { crawlDelayFor, isAllowedByRobots, parseRobots, type RobotsGroup } from "@/lib/robots";

/**
 * Polite HTTP for ingestion: an honest bot user-agent (never a spoofed
 * browser), robots.txt enforcement, per-host spacing, timeouts and
 * exponential backoff on transient failures.
 */

export const BOT_TOKEN = "FundingPulseBot";

export function userAgent(): string {
  const site = getEnv().NEXT_PUBLIC_APP_URL ?? "https://github.com";
  return `Mozilla/5.0 (compatible; ${BOT_TOKEN}/0.1; +${site})`;
}

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`Disallowed by robots.txt: ${url}`);
    this.name = "RobotsDisallowedError";
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
  headers?: Record<string, string>;
  /** Skip robots.txt — only for APIs (not crawling), e.g. a news or FX API. */
  skipRobots?: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Per-invocation caches. Serverless instances are short-lived; that's fine.
const robotsCache = new Map<string, Promise<RobotsGroup[] | "disallow_all">>();
const lastHit = new Map<string, number>();
const hostSpacing = new Map<string, number>();
const DEFAULT_SPACING_MS = 1000;

async function politeWait(host: string): Promise<void> {
  const spacing = hostSpacing.get(host) ?? DEFAULT_SPACING_MS;
  const prev = lastHit.get(host);
  const next = prev === undefined ? Date.now() : Math.max(Date.now(), prev + spacing);
  lastHit.set(host, next);
  const wait = next - Date.now();
  if (wait > 0) await sleep(wait);
}

async function rawFetch(url: string, timeoutMs: number, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { "User-Agent": userAgent(), Accept: "*/*", ...headers },
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function loadRobots(origin: string): Promise<RobotsGroup[] | "disallow_all"> {
  try {
    const res = await rawFetch(`${origin}/robots.txt`, 10_000, { Accept: "text/plain" });
    // RFC 9309: 4xx → no restrictions; 5xx → assume complete disallow.
    if (res.status >= 500) return "disallow_all";
    if (!res.ok) return [];
    return parseRobots(await res.text());
  } catch {
    return "disallow_all";
  }
}

export async function assertRobotsAllowed(url: string): Promise<void> {
  const u = new URL(url);
  let pending = robotsCache.get(u.origin);
  if (!pending) {
    pending = loadRobots(u.origin);
    robotsCache.set(u.origin, pending);
  }
  const groups = await pending;
  if (groups !== "disallow_all") {
    const delay = crawlDelayFor(groups, BOT_TOKEN);
    if (delay !== null) hostSpacing.set(u.host, Math.max(DEFAULT_SPACING_MS, delay * 1000));
  }
  if (groups === "disallow_all" || !isAllowedByRobots(groups, BOT_TOKEN, u.pathname + u.search)) {
    throw new RobotsDisallowedError(url);
  }
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<{ text: string; finalUrl: string }> {
  const { timeoutMs = 15_000, retries = 2, baseDelayMs = 800, headers = {}, skipRobots = false } = opts;
  if (!skipRobots) await assertRobotsAllowed(url);
  const host = new URL(url).host;

  // A host with a long Crawl-delay is not retried within this invocation:
  // waiting would push the stage past its time budget. The next run retries.
  const maxAttempts = (hostSpacing.get(host) ?? DEFAULT_SPACING_MS) > 5_000 ? 0 : retries;

  let lastError: FetchError | null = null;
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    if (attempt > 0) await sleep(baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
    await politeWait(host);
    try {
      const res = await rawFetch(url, timeoutMs, headers);
      if (res.ok) return { text: await res.text(), finalUrl: res.url || url };
      const retryable = res.status === 429 || res.status >= 500;
      lastError = new FetchError(`HTTP ${res.status}`, res.status, retryable);
      if (!retryable) break;
    } catch (err) {
      const msg = err instanceof Error && err.name === "AbortError" ? "timeout" : "network error";
      lastError = new FetchError(msg, null, true);
    }
  }
  throw lastError ?? new FetchError("unknown fetch failure", null, false);
}
