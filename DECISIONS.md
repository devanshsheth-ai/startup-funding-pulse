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

---

## M4 — Backfill (2026-10-11)

**D-039 · Roundup sources.** Two publications publish a dated weekly roundup that robots.txt
permits us to fetch:
- **Inc42 "Funding Galore":** a full deal table (date, company, sector, sub-sector, model,
  amount, round, investors, lead), discovered through its tag RSS feed, which carries
  publish dates. Inc42's robots.txt forbids pagination and query strings, which the feed
  avoids. Its content signal allows AI input (`ai-input=yes`).
- **Entrackr "Funding and acquisitions in Indian startups this week":** prose plus
  appointments, fund launches and M&A, discovered from its two category archives (pages 1–2).
  The week range is parsed from the URL slug, with the year inferred so a week is never in
  the future.

Both are seeded as `type = roundup`, `enabled = false`, `last_status = backfill_only`. The
live collector skips them, and `/health` labels them "backfill source". Each is named after
the outlet ("Inc42", "Entrackr"), so corroboration counts outlets, not feeds. An Inc42
article and an Inc42 roundup reporting the same deal count as one source.

**D-040 · One week per roundup source, 13 weeks.** Discovery keeps one roundup per ISO week
per source, newest first. That is 13 weeks: 12 of baseline plus the current one. Entrackr's
archive lacks 13–18 July, so its 13th roundup is the week before. Inc42 covers that week.

**D-041 · Roundup extraction is separate from article extraction.** `extract-roundup.v1`
takes one roundup and returns `{deals[], events[]}` in one call (maxOutputTokens 32k). Roundups
are stored as `raw_articles` with `event_type_guess = 'roundup'` and a `week:` category. The
live extract stage explicitly excludes them, so they never go through the per-article prompt.
Records are tagged `ingestion_mode = 'backfill'` and take the same Stage C/D/E path as live
data, so a deal seen live and in a roundup merges into one deal with both sources. A deal
first created by live collection keeps `ingestion_mode = 'live'`.

**D-042 · Cross-check method.** For the 3 most recent roundup weeks, the normalised company
names extracted from roundups are compared with the companies of deals collected live in the
same ISO weeks. The result is logged to `run_logs` (stage `backfill_crosscheck`) with both
recall directions and the unmatched names on each side.

**D-043 · Thinking level and timeouts.** The first backfill run hit `504 DEADLINE_EXCEEDED`.
With default thinking, one roundup took 66 s, more than the 60 s request deadline (which is
passed to Google). Measured on the same Inc42 roundup, `thinkingLevel: LOW` took 49 s, used
0 thought tokens instead of 3,352, and extracted the same 21 deals. → Classify, extract and
adjudicate run with LOW thinking. Narration keeps the model default. The request timeout
scales with the requested output size: 240 s for calls above 8,192 output tokens (roundups),
60 s otherwise.

**D-044 · Fuzzy dedupe guards (from the M4 audit).** After the backfill, an audit of merges
whose source names a different company found 5 cases. Four were correct spelling variants
(e.g. "Banglore"/"Bangalore Watch Company", "Carrum"/"Carrum Mobility"). One was false:
Zoppler Systems was merged into KshatraLabs by Gemini adjudication, because both were Inc42
rows (two different weekly tables) for defence-tech startups backed by the same accelerator.
Fixes:
1. Fuzzy layers (3–4) never merge two records from the same publication, which never lists
   one deal twice under different names. Exact layers (1–2) still can.
2. `dedupe-adjudicate.v2` requires the names to plausibly be the same entity, and states
   that shared investors, sector or description are not evidence.
3. A real SQL precedence bug was fixed: drizzle's `and()` does not parenthesise each
   condition, so the candidate query's `… OR trigram > 0.7` escaped the date-window, stage
   and publication filters. The OR is now wrapped.

The bad link was repaired (link row removed, record re-processed through v2, which rejected
all 3 candidates). The post-repair audit shows only the 4 legitimate variants.

---

## M5 — Scoring and adjacency (2026-10-11)

**D-045 · Excluded "sectors" that are not taxonomy sectors.** PRD §8.1 excludes "Real-money
gaming", "Crypto/Web3 tokens" and "K-12 Edtech", which are sub-sectors of taxonomy sectors
(Gaming, Fintech, Edtech). → A `sectors_excluded` entry that is a taxonomy sector excludes the
whole sector. Any other entry is a label, enforced through `keywords_excluded` ("rummy",
"fantasy sports", "crypto exchange", "k-12", …). Keywords match on word boundaries against the
sub-sector, description and company name. Exclusion is applied before scoring: score 0, tier
archive, no components (PRD §11.2).

**D-046 · Sector-fit cache.** PRD §11.1 says to cache Gemini's sector fit per (sector,
sub-sector, profile). → `sector_fit` stores (profile, sector, lowercased sub-sector,
mandate_hash). mandate_hash covers only core and watch sectors, so editing a weight never
re-calls Gemini, but editing the sectors re-evaluates. Pairs are sent 40 per call
(`sector-fit.v1`, calibration anchors from §11.1).

**D-047 · Adjacency shortlist calibration.** PRD §13.2's 0.72 cosine threshold was measured
against our data. With `gemini-embedding-001` at 768 dims, the median company scores 0.74–0.79
against every tracked company, so 0.72 admitted 238–252 of 252 companies per tracked company.
That defeats Phase 1 (about 3,000 adjudications). → The shortlist is the **15 most similar
companies above 0.78** (above the median) per tracked company, about 180 adjudications on the
first run, all content-cached after. The top-ranked pairs were sensible (Bizongo ← Udaan,
Groyyo; Rupifi ← NeoGrowth; The Whole Truth ← Protein Pantry). Edges are written for
`is_related` with confidence ≥ 0.6, as specified. A tracked company's own raise is excluded
from adjacency, because it is a `portfolio_mentioned` alert (M9).

**D-048 · Portfolio description updates (verified 2026-10-11).**
- Even Healthcare has pivoted to a hospital-led managed-care model and is winding down
  insurance (2026 layoffs; own Bengaluru hospitals). Its description and keywords drop
  "hospitalisation cover" / "health insurance alternative", which would mis-flag insurers
  as competitors.
- Sarvam AI adds speech models and agent platforms (Arya, Samvaad, Bulbul).
- Rupifi adds SME cards. Khatabook adds merchant lending.

The other two profiles' portfolios, which the PRD leaves open, use verified real companies as
simulated holdings: Kiwi, Stable Money and Scapia (fintech seed fund); Snitch, Sleepy Owl and
Slikk (consumer syndicate).

**D-049 · Taxonomy mapping of Aarav's "Consumer & D2C".** The taxonomy splits this into
"D2C & Commerce" and "Quick Commerce", so both are core sectors. "AI infrastructure" stays a
sub-sector of core AI Applications, so sector fit rates AI Infrastructure deals highly.

**D-050 · Rubric edge cases (PRD silent).**
- Unnamed rounds (`Undisclosed`) score 0 stage fit, per "else score 0". Debt or Grant use the
  prior equity stage when the article names one.
- City not reported scores 0 geography, rather than "other India".
- An undisclosed amount contributes 0 to the cheque-percentile term of ecosystem
  significance; cheque fit itself stays neutral (4/10).
- The percentile bucket needs ≥ 5 priced deals in stage × sector, else stage-only, else none.
- Investor tier is the deal's best investor `deal_count` percentile in our own data.
- The `investor_first_move` override is wired but stays off until the M6 investor-rotation
  detector and its four guards exist.
- Recency and serendipity use the profile's digest window (`last_digest_sent_at` → now, else
  7 days). Deals before the window score 0 recency, but are still scored, so the explorer can
  rank them.

---

## M6 — Aggregates and patterns (2026-10-12)

**D-051 · Detector calibrations (measured on our data).**
- **Thesis clustering:** cohesion must exceed max(0.75, the corpus 99th-percentile pairwise
  cosine). With `gemini-embedding-001`, the median company pair already scores ≈ 0.77, and
  roundup-derived template descriptions ("AI startup operating in the application layer")
  embed as near-twins (≈ 0.95). So 0.75 alone would call any three deals a thesis, which is
  the false positive the PRD warns about. The corpus p99 is ≈ 0.92 today. When quiet, the
  detector reports its tightest triple.
- **Sector momentum:** σ is floored at 1 deal/week, so a flat baseline (e.g. 0, 0, 0) cannot
  yield an infinite z-score. Both directions are reported. Accelerating needs ≥ 3 deals this
  week; cooling needs a baseline mean ≥ 3.
- **Outlier deal:** z is computed on log10(amount). Round sizes are heavy-tailed, so a linear
  σ is set by one mega-round. The bucket excludes the deal itself, and n ≥ 8 is required
  (stage × sector, else stage-only, else suppressed).
- **Geographic shift:** also requires ≥ 20 baseline deals with a reported city. Weekly
  roundups rarely name cities (0–5 per week), so the detector is suppressed with that reason
  until live history accumulates.
- **Follow-on compression:** needs ≥ 4 recent (last 4 weeks) **and** ≥ 4 earlier round pairs,
  else suppressed with the counts. Prior-round mentions come from full articles, so they are
  concentrated in live data.
- **Confidence labels:** effect ≥ 2 × e_min → strong; ≥ 1.33 × → emerging; otherwise
  weak_signal.
- **Target week:** the latest completed ISO week (Sunday ≤ today). The baseline is the 8
  calendar weeks before it; weeks with zero deals count as zeros.

**D-052 · Pattern subjects and detector outcomes.** PRD §7.4 keys patterns on (profile, week,
detector), but one detector can fire for several subjects in a week (Fintech *and* Healthtech
momentum), and §14.4 tracks "the same subject last week". → patterns are keyed on (profile,
week, detector, subject), carrying run_id and consecutive_weeks. A new `detector_runs` table
stores every detector's outcome per profile and week (fired / quiet / suppressed, reason,
gates, observed n / effect / baseline weeks), which /methodology renders.

**D-053 · Order of stages.** Detect runs before score, because the PRD §11.2 `investor_first_move`
override (+10) comes only from investor-rotation findings that passed all four guards, for a
watchlist investor in a mandate core sector. It first fired for Aarav on 3one4 Capital's first
Healthtech deal (Sunfox Technologies).

**D-054 · Aggregates window and temperature.** Window comparisons use the digest window,
normalised to a 7-day rate, against 8 seven-day buckets ending at the window start (fixed
regardless of cadence). Market temperature maps each component's z-score through the standard
normal CDF (Φ(z) × 100), weighted 0.35 / 0.35 / 0.15 / 0.15 per PRD §12.3, and always
returns its raw components. Coverage success rate includes the GNews sources that currently
lack a key.

**Known limitation:** the current week has both live collection and roundup coverage, while
the baseline weeks have only roundups. That raises counts for the newest week (33 deals vs a
≈ 22/week baseline), so momentum for the current week is biased upward until live history
replaces backfill in the baseline. This is stated in the README limitations.

---

## M7 — Digest and email (2026-10-12)

**D-055 · The cluster trigger uses announcement dates.** PRD §13.3 counts edges by
`detected_at`, but backfilled deals are all "detected" on the day the backfill runs, which
would make the cluster alert fire for July deals. → The trigger counts competitor and
same-layer edges whose **deal was announced** within `cluster_window_days`, the question the
brief actually asks ("raised within the same ten-day window"). It fired live for Even
Healthcare: Kinetic Age (6 Oct) and Vytalyou (30 Sep).

**D-056 · Digests store their full content.** `digests.content` keeps the exact assembled
DigestContent, and `digests.rejected` keeps every narration paragraph or bullet that code
rejected, with the reason. `/share/[token]` re-renders exactly what was emailed, and the
evidence enforcement is auditable.

**D-057 · The delivery recipient is overridden for the demo.** Resend's shared test sender
(`onboarding@resend.dev`) only delivers to the Resend account owner, and the account's
`kargo.com` domain is unverified. → `DIGEST_TO` (an env var, never committed, so no personal
email lands in the public repo) overrides the profiles' placeholder recipients. Verifying a
domain and setting `EMAIL_FROM` removes the need.

**D-058 · Gmail clipping guard.** Gmail clips HTML emails above ~102 KB, hiding the footer and
the required disclosure. The first weekly render was 110 KB. → Ranked deals are capped at 12
(scorecard lines only for act-now/high), adjacency is grouped one card per deal (max 6), and
sources are capped at 3 per card. `renderDigest` also trims progressively whenever the HTML
exceeds 98 KB. The full lists stay on the dashboard.

**D-059 · Cron at 01:00 UTC (06:30 IST).** The PRD's `30 0 * * *` is 06:00 IST, before
Aarav's 06:30 send hour, so a once-a-day run would never find the weekly digest due. Hobby
crons can fire up to 59 minutes late, so the digest arrives 06:30–07:29 IST, before work.

**D-060 · Narration safeguards in code.** Beyond the PRD's evidence rule:
- Evidence IDs not present in the input are stripped. A paragraph with none left is rejected.
- Ownership claims about the simulated portfolio ("our portfolio", "we invested", "holds a
  stake in …") are rejected.
- TL;DR and LP bullets without a number are dropped.
- A headline over 90 characters, or without a number, is replaced by a deterministic one.

If Gemini is unavailable, the digest still sends with complete figures and is marked
"narrative unavailable this run".

**D-061 · GNews queries (measured on the free tier, 2026-10-12).** On the free plan (12-hour
delay, "up to 10 per request"), the 11 seeded queries from PRD §9.1 together returned 3
articles. Every sector-specific or operator query ("India fintech startup raises", "Indian
startup \"Series A\" OR \"Series B\" raises", "India startup acquires OR acquisition") returned
0, and the `from` date filter returns nothing on this plan. Broad queries return results.
→ Six broad queries with `country=in` replace them: "startup funding", "startup funding
India", "Indian startups funding", "startup raises crore", "seed funding Indian startup",
"venture capital fund India". The first live run fetched 31 articles (22 new). Stage A filters
the off-topic ones cheaply. The 11 originals stay in the registry, disabled with this reason,
and quota use drops from 11 to 6 of the 100 daily calls.

**D-062 · Function duration for digest work.** On Vercel, the weekly preview took 48 s, almost
all of it the Gemini narration call, against a 60 s `maxDuration`. The scheduled send runs in
the dispatcher after collection and scoring, so a slow narration could be killed mid-send.
→ The dispatch, preview and manual-digest routes declare `maxDuration = 300` (the Hobby
maximum). Chunked pipeline stages still stop at their 50 s work budget and continue in a new
invocation; only the single digest step uses the headroom. The Gemini call has its own 60 s
timeout, so no invocation can approach 300 s.
