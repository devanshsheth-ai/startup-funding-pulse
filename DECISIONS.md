# DECISIONS.md

A log of every implementation decision made where the PRD was ambiguous, contradicted
current platform reality, or left a choice open. Newest milestone at the bottom.
Format: **ID · decision** — context → choice → consequence.

---

## M0 — Foundation (2026-10-11)

**D-001 · Spec versions.** Two PRD/CLAUDE.md revisions were supplied. The later
revision (real companies as *simulated holdings*, with the mandatory disclosure) is
the one committed at `docs/PRD.md` and `CLAUDE.md`. The earlier fictional-portfolio
version is superseded.

**D-002 · Gemini SDK is `@google/genai`, not `@google/generative-ai`.** PRD §5 locks
`@google/generative-ai`. Verified 2026-10-11: that package is deprecated, support ended
30 Nov 2025, and its repository was archived on 16 Dec 2025. Google's replacement is the
unified `@google/genai` SDK. → Use `@google/genai`. It is still Google Gemini, so the
"Gemini Flash only" hard constraint is unaffected. All SDK access stays behind
`src/lib/gemini.ts` (built in M2).

**D-003 · Model IDs and embedding dimension.** Verified against ai.google.dev on
2026-10-11. The current stable Flash models are `gemini-3.8-flash` (newest), `gemini-3.6-flash`,
and the Flash-Lite variants. Gemini 2.5 access is restricted for new projects. The
embedding models are `gemini-embedding-2` (auto-normalises truncated output) and
`gemini-embedding-001` (needs manual normalisation below 3072 dims). Both support
`outputDimensionality` 128–3072, with 768 recommended. → Schema uses `vector(768)`
(`EMBEDDING_DIMENSIONS` in `src/db/schema.ts`). Model IDs are env-configured
(`GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`), never hardcoded. The exact model choice is
confirmed with a live call at M2, and if the chosen embedding model does not
auto-normalise, the wrapper normalises.

**D-004 · Env validation is staged.** CLAUDE.md asks for all env validated at
startup. Requiring every key from day one would block the M0 deploy on keys that no
built feature uses yet. → `DATABASE_URL` is required by the Zod schema. Other keys
are optional in the schema and asserted with `requireEnv()` at the point of use, so a
missing key fails loudly in the feature that needs it. Each key moves to required in the
schema at the milestone that makes it essential.

**D-005 · Platform limits (verified 2026-10-11).** Vercel Hobby allows up to 100
cron entries, each at most once per day, with ±59-minute precision. Hobby function max
duration is 300 s (Fluid compute). → Keep the PRD design: **one** daily cron with
profile-aware dispatch (simpler, and once per day is the binding constraint anyway),
and keep the self-imposed **60 s per-invocation budget** for headroom, even though
the platform allows 300 s. The cron entry is added in M1, alongside the dispatcher
route it calls.

**D-006 · `created_at` / `updated_at` on every table.** PRD §7 omits them on some
tables. CLAUDE.md §2 requires them. → Added everywhere. `updated_at` is maintained by
Drizzle's `$onUpdate` on ORM writes. Raw SQL writes must set it explicitly.

**D-007 · `digest_items` key.** PRD §7.5 declares `PRIMARY KEY (digest_id,
COALESCE(deal_id,''), COALESCE(event_id,''), section)`. Postgres does not allow
expressions in a primary key. → Surrogate `serial id` plus a **unique expression index**
on the same four terms. The uniqueness semantics are identical.

**D-008 · Default exports where frameworks require them.** CLAUDE.md says named
exports only. Next.js (`page.tsx`, `layout.tsx`, `next.config.ts`), drizzle-kit
(`drizzle.config.ts`) and Vitest (`vitest.config.mts`) require default exports. →
Default exports appear only in those framework-mandated files. All application code
uses named exports.

**D-009 · `portfolio.relationship_type` column.** PRD §8.2 rule 2 requires each
portfolio row to carry `relationship_type: "simulated_holding"`, and the UI reads its
label from it. → Stored as a column (default `simulated_holding`), not only in profile
JSON, so every query that renders a portfolio row has it.

**D-010 · `sources.url` is unique.** It is not in the PRD, but it is needed so the
idempotent seed script (M1) can upsert the source registry without duplicating rows.

**D-011 · Package manager is npm.** PRD §20 refers to `pnpm seed`. pnpm is not
installed in the build environment, and npm ships with Node. → npm scripts. `npm run seed`
replaces `pnpm seed`. Nothing else depends on pnpm.

**D-012 · pgvector enabled by migration `0000`.** A hand-written first migration
runs `CREATE EXTENSION IF NOT EXISTS vector` before `0001_init` creates any vector
column. A fresh Neon branch therefore needs no manual console step.

**D-013 · Health probe route.** M0's acceptance check is implemented at
`GET /api/health/db`. It is read-only: it runs `SELECT 1`, echoes a vector through
`::vector::text`, computes `<=>` cosine distance in Postgres, compares it with the
same distance computed in TypeScript, and reports the pgvector extension version. The
full `/health` page (sources, funnel, run logs) is built from M1 onward.

---

## M1 — Ingestion (2026-10-11)

**D-014 · Tier 1 sources were verified live, not assumed.** Each source was probed on
2026-10-11.
- **Working:** Entrackr (`/rss`), Inc42, YourStory, the ET Tech Startups and Funding
  feeds, Mint Companies, BusinessLine Companies, TechCrunch India, Moneycontrol Business
  (intermittent; see below) and VCCircle (HTML listing).
- **Disabled, with the reason stored on the source row and shown on `/health`:**
  - Business Standard returns 403 to identified bots.
  - Techcircle's listings stop at 2023.
  - The CapTable does not respond.
  - MediaNama's robots.txt disallows `*/feed/*`.

Broad business feeds (Mint, BusinessLine, Moneycontrol) were added for coverage. Stage A
filters out their non-startup noise cheaply.

**D-015 · Google News RSS is excluded and Tier 2 uses the GNews API.** PRD §9.1 suggests
Google News RSS query endpoints, but news.google.com's robots.txt disallows `/rss/search`
for all agents, and PRD §9.2 forbids fetching robots-blocked content. → Tier 2 is the GNews
search API. Its free tier allows 100 requests a day, 10 articles per request and a 12-hour
delay, for non-commercial and academic use, which this exam project is. There are 11
structured queries per run, per §9.1. The key comes from `NEWS_API_KEY`, is appended at
request time and is never stored. With no key, those sources record an honest error rather
than being faked.

**D-016 · `sources.config` (jsonb).** Parser-specific options, such as the HTML listing
link pattern, live on the registry row, so adding an HTML source is a config change, not a
code change.

**D-017 · Bodies are fetched lazily.** Listing pages and teaser feeds provide only a headline
or lead. Fetching full pages for every item would cost the most on articles the filter
rejects (about 80%). → Store what the feed gives. Stage B fetches the article page only for
items Stage A marks relevant, and resolves `<link rel=canonical>` at that point. Article
identity stays the hash of the normalised feed URL, which is stable across re-runs.

**D-018 · Honest crawling.** The user-agent is `FundingPulseBot/0.1`, never a spoofed
browser. robots.txt is parsed per RFC 9309 (a 5xx means disallow-all, a 4xx means
allow-all) and checked before every crawl request. Crawl-delay is honoured as per-host
spacing. Hosts with a Crawl-delay over 5 s are not retried within an invocation, to protect
the time budget; the next run retries them. APIs (GNews, FX) are not crawling and skip the
robots check.

**D-019 · Live freshness window.** Live collection drops items published more than 21 days
ago, so a stale feed cannot pass old news off as current. Weeks of history come only from the
dated weekly-roundup backfill (M4). Future publish dates are clamped to fetch time.

**D-020 · Dispatcher continuation.** `/api/cron/dispatch` replies 202 at once and runs the
stage chain in `after()`, within `maxDuration = 60` and a 50 s work budget. When the budget
runs out it calls itself with `(run_id, stage, cursor)`, capped at 50 hops, so one logical run
spans several short invocations under one `run_id`. `?sync=1` runs inline for manual triggers.
Cron and manual stage endpoints accept `CRON_SECRET` or `ADMIN_SECRET` as a Bearer token. An
unset secret denies every request.

**D-021 · FX source.** Frankfurter (ECB reference rates) is keyless and supports date ranges,
which backfill needs. Configured via `FX_API_URL` (`https://api.frankfurter.dev/v1`). The FX
stage runs first in the chain, and a failure there never blocks collection.

**D-022 · Shared HTTP lives in `src/lib`.** `http.ts` (polite fetch) and `robots.ts` are
infrastructure used by ingestion and FX, so they sit in `lib` rather than in a pipeline
stage's module.

---

## M2 / M3 — Extraction, normalisation, dedupe, enrich (2026-10-11)

**D-023 · `extracted_records` staging table.** PRD §10 Stage B says output goes "to a staging
state" but defines no table. → `extracted_records` holds one Zod-validated payload per
candidate record, with its prompt version, ingestion mode and status (`pending` → `merged` or
`rejected`, with a reason). It is the "candidate records" step of the dedupe funnel on
`/health`, and it lets a prompt change be replayed against stored articles.

**D-024 · `gemini_cache` table.** CLAUDE.md §4 asks for caching by content hash. → The key is
sha256(model | prompt id | rendered prompt). A prompt-version bump changes the key, so an
edited prompt is never answered from a stale cache.

**D-025 · A null sector maps to `Other`.** `deals.sector_primary` is NOT NULL, and the
extractor is told to return null rather than guess. → An unclassifiable deal goes to `Other`,
the taxonomy's explicit bucket, which is visible and countable. It is never assigned a
guessed sector.

**D-026 · Per-source reports and recompute-on-merge.** PRD §6.10 requires field-level badges
(corroborated, single-source, disputed). → Each `deal_sources` row stores what that source
reported (stage, amount and its confidence, lead investors). The deal row is always recomputed
from all of its sources by the pure `mergeReports()`. That makes merging idempotent and
order-independent, and the PRD merge rules are unit-tested. `Undisclosed` is treated as
compatible with any named stage when matching, and defers to the named stage when merging,
because one outlet often omits the round name another prints.

**D-027 · `events.subject_key`.** Event identity needs a stable subject: the target for M&A,
the fund name for fund closes, `person@company` for people moves. → It is stored and indexed,
so the same event reported in two different ISO weeks within ±14 days still merges.

**D-028 · Round pairs come from existing columns.** Stage E.4 asks to "write prior round back
onto company history". → No new table. Detector 7's round pairs are derived from
`deals.prior_round_stage` / `prior_round_date` (extracted from "has raised X to date"
sentences) plus consecutive observed rounds for the same company.

**D-029 · Structured output uses `responseJsonSchema`, generated from Zod.** CLAUDE.md §4
names `responseSchema`. In `@google/genai`, `responseJsonSchema` is the documented field for
standard JSON Schema. → Each output contract is one Zod schema that is both sent to Gemini
(via `z.toJSONSchema`, with `$schema` and safe-integer bounds stripped) and used to validate
the reply. The contract and the check cannot drift apart. Temperature ceilings (≤ 0.2 for
classify, extract and adjudicate; ≤ 0.4 for narrate) are enforced in code.

**D-030 · Gemini pacing.** Free-tier limits change and are per-model. → `GEMINI_RPM`
(default 10) spaces calls. 429 and 5xx errors retry with exponential backoff. If quota is
exhausted, the stage pauses cleanly and records `partial` with the reason, and the next
daily run resumes the backlog. Nothing is marked processed that wasn't.

**D-031 · Body fetching is bounded.** Article pages are fetched (robots-checked) only for
relevant articles whose feed text is under 600 characters, one at a time per host, and are
skipped if the host's politeness wait exceeds 3 s. VCCircle's 20 s Crawl-delay therefore
means its articles are extracted from headline and lead. Text comes from JSON-LD
`articleBody` when present, otherwise from the densest `<p>` block.

**D-032 · Layer 3/4 candidates.** Layer 3 compares the candidate's embedding with existing
companies' embeddings, within the same window and a compatible stage. Layer 4 sends up to 3
of the nearest candidates to Gemini: cosine 0.78–0.88, or pg_trgm name similarity above 0.7
(the pg_trgm extension is enabled in migration 0004). Adjudication needs `same_event` with
confidence ≥ 0.7. Until the Gemini key is configured, only layers 1–2 run, and `/health`
reports that.
## Deployment (2026-10-11)

**D-033 · Functions run in `sin1` (Singapore).** Neon is in AWS ap-southeast-1 (Singapore).
Vercel's default function region is `iad1` (US East). The first production probe measured
a 1.3 s `SELECT 1` round trip across that distance, and every pipeline query pays it.
→ `vercel.json` pins `"regions": ["sin1"]`, co-locating compute with the database.

---

## M2 / M3 — live verification fixes (2026-10-11)

**D-034 · Migrations run in a transaction.** The Neon HTTP migrator is not transactional: a
failed run left migration 0003's tables created but unrecorded. → `src/scripts/migrate.ts`
uses Neon's WebSocket `Pool` with the `neon-serverless` migrator, so pending migrations apply
atomically. This is a local CLI script only; serverless routes stay on the HTTP driver. The two
half-created tables were verified empty before they were dropped and re-applied.

**D-035 · The Gemini schema is a keyword allowlist.** The live API rejected the extraction
schemas with INVALID_ARGUMENT. Bisecting showed two causes: keywords outside Gemini's subset
(`pattern`, `exclusiveMinimum`, string lengths), and nested `minItems`/`maxItems`, which blow
up the constrained-decoding grammar. → `toGeminiSchema` keeps only the documented keywords
and drops array-length limits. Zod still enforces every original rule on each reply, so
validation is unchanged. Each Gemini request has a 60 s timeout. A 4xx other than 429 is
logged as "rejected the request", not "unavailable", and pauses the stage instead of
quarantining every article.

**D-036 · Undated listing items use their first-seen date.** VCCircle's homepage listing
carries no dates, and its 20 s Crawl-delay prevents most article-page fetches. → When neither
the article nor the feed gives a date, `fetched_at` (when we first saw it on the live listing)
is the announced-date fallback. It is accurate to within days for a homepage listing, and
better than discarding the deal.

**D-037 · Layer 3 needs name agreement to auto-merge.** PRD §10 calls a cosine > 0.88 pair a
*candidate*. The first build auto-merged on it, and the M2 spot-check caught three false
merges: Beyond Appliances was attached to both Lorazzo and EDT, and Ultraviolette to Simple
Energy (same niche, same week, both stage "Undisclosed"). → Layer 3 auto-merges only when
cosine ≥ 0.88 **and** pg_trgm name similarity ≥ 0.5. All other near matches go to Gemini
adjudication. Repair: the three erroneous `deal_sources` link rows were removed (the articles
and extractions were kept), the records re-processed, and the affected deals recomputed.
A post-repair audit found 0 sources naming a different company from their deal.

**D-038 · Log redaction keeps usage counts.** The secret-key pattern matched any key
containing "token", which hid Gemini token counts in logs. → It now matches credential-style
keys only (`token`, `access_token`, `auth_token`, …), not `tokens` / `gemini_tokens`.
