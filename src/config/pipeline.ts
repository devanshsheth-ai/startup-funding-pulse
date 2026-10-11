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
  filter: {
    /** Articles per Gemini classification call (PRD: 20). */
    batchSize: 20,
    /** Relevant only when the classifier is at least this confident. */
    minConfidence: 0.5,
  },
  extract: {
    /** Articles per Gemini extraction call (PRD: 5–10). */
    batchSize: 5,
    /** Characters of article text sent per article. */
    maxCharsPerArticle: 6000,
    /** Fetch the article page when the stored body is shorter than this. */
    minBodyChars: 600,
    maxArticlesPerInvocation: 40,
  },
  dedupe: {
    windowDays: 14,
    /** Layer 3: cosine similarity at or above this (with stage + window) → same deal. */
    vectorSame: 0.88,
    /** Layer 3 auto-merges only if pg_trgm name similarity also reaches this. */
    layer3MinNameSimilarity: 0.5,
    /** Layer 4: similarity in [vectorLow, vectorSame) is sent to Gemini adjudication. */
    vectorLow: 0.78,
    /** Layer 4: pg_trgm name similarity above this is also adjudicated. */
    trigram: 0.7,
    adjudicateMinConfidence: 0.7,
    maxAdjudicationsPerCandidate: 3,
    recordsPerInvocation: 60,
  },
  score: {
    /** Sector-fit pairs per Gemini call. */
    sectorFitBatch: 40,
    /** Cheque percentile needs at least this many priced deals in a bucket (else stage-only, else none). */
    chequeBucketMin: 5,
    /**
     * Phase 1 vector shortlist floor. PRD §13.2 says 0.72, but gemini-embedding-001
     * places the median company at 0.74–0.79 against every tracked company, so
     * 0.72 admits nearly everything. Calibrated to 0.78 plus a top-N cap (D-047).
     */
    adjacencyMinSimilarity: 0.78,
    /** Write an edge only when Gemini is at least this confident (PRD §13.2). */
    adjacencyMinConfidence: 0.6,
    /** Shortlist size per tracked company: the N most similar above the floor. */
    adjacencyMaxPerPortfolio: 15,
  },
  retention: {
    bodyTextDays: 30,
  },
} as const;
