/**
 * Pipeline tunables in one place (CLAUDE.md §3: nothing hardcoded inline).
 * Detector gates and scoring weights live in their own config files.
 */
export const PIPELINE = {
  /** Self-imposed ceiling per invocation; the platform allows 300 s (D-005). */
  invocationBudgetMs: 50_000,
  /** Per-route maxDuration declared to Vercel. */
  maxDurationSec: 60,
  collect: {
    defaultLimit: 25,
    /**
     * Live collection ignores items published more than this many days ago, so a
     * stale feed cannot inject old news as "this week". History comes from the
     * dated weekly-roundup backfill instead (D-019).
     */
    liveMaxAgeDays: 21,
    insertBatchSize: 100,
  },
  retention: {
    bodyTextDays: 30,
  },
} as const;
