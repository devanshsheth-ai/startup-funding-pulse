# Startup Funding Pulse — Product Requirements Document

**Version:** 1.0
**Owner:** Devansh Sheth
**Context:** MESA Cohort C4 — AI and its Applications, Section 1, Final Examination, Problem Statement 14 (Medium Difficulty)
**Status:** Approved for build

---

## 0. How to use this document

This PRD is the single source of truth for the build. It is written for an AI coding agent (Claude Code) and a human reviewer.

Rules for the implementing agent:

1. **Read this entire document before writing code.** Re-read the relevant section before starting each milestone.
2. **Do not invent requirements.** If something is genuinely ambiguous, implement the simplest defensible option, write the decision into `DECISIONS.md`, and flag it in your summary.
3. **Build in the milestone order in §24.** Each milestone has acceptance criteria. Do not advance until they pass.
4. **Obey `CLAUDE.md`** — it contains the non-negotiable engineering rules and is shorter than this file.
5. **Verify external facts.** Model IDs, SDK versions, free-tier limits and API shapes change. Check current documentation before relying on any version number or limit stated here. Where this document says "verify", it means verify.
6. **Never fabricate data.** No mock deals, no placeholder funding rounds, no seeded fake articles. Every record in the database must trace to a real fetched source. The examination requires live data.

---

## 1. Problem context

### 1.1 The assigned problem (verbatim intent)

Aarav is a venture scout at a Bengaluru-based family office backing early-stage Indian startups. His job is staying current on what is getting funded — not just individual deals, but the patterns behind them. Which sectors are attracting capital this week? Is deal activity in a space his portfolio touches accelerating or cooling? Has a new investor started making moves in his target verticals?

The Indian startup ecosystem generates roughly 40–60 funding announcements a week, scattered across press releases, startup media, investor social posts and financial newswires.

Today Aarav skims two or three publications each morning and checks his social feed. He catches maybe sixty percent of notable deals and misses nearly everything in sectors he does not already follow. He keeps a spreadsheet of relevant deals — stage, amount, lead investor, sector — but it is perpetually three weeks behind and incomplete.

**The defining failure:** last month two companies directly adjacent to a portfolio company raised within the same ten-day window. Aarav found out during a board meeting, when the founder mentioned it. He should have known before the board meeting.

He wants a Monday morning brief consolidating the previous week's Indian startup funding activity from across every source where such announcements appear. Not a raw feed of headlines — **signal extracted from noise.** It should surface deals in his focus sectors and stages first, identify patterns across the week's deal flow, and flag any announcement involving a company on his watchlist. His sectors, stages and watchlist must live in a config he can update himself as his mandate evolves.

### 1.2 The four requirements hidden in the narrative

| # | Signal in the story | Requirement it creates |
|---|---|---|
| 1 | "catches maybe sixty percent", "misses nearly everything in sectors he doesn't follow" | **Coverage is a graded dimension.** Breadth of sources matters. A system surfacing 8 deals a week has failed the premise. |
| 2 | "He doesn't want a raw feed of headlines" | **Extraction, ranking and synthesis are the product.** A list of links is the wrong answer. |
| 3 | "two companies adjacent to a portfolio company raised within ten days" | **Portfolio adjacency detection is the acceptance test.** Every design decision is judged against: *would this have caught those two deals?* |
| 4 | "stored in a config he can update himself" | **Self-service configuration.** Hardcoded constants fail this. |

### 1.3 The anti-blind-spot principle

A relevance filter tuned perfectly to Aarav's stated mandate would reproduce exactly the blind spot the product exists to fix — he already misses sectors he does not follow. **The system must deliberately break its own filter** and surface high-significance deals from outside the mandate. This is implemented as the Serendipity Override (§11.4) and must be stated explicitly in the product's methodology page.

---

## 2. Examination constraints (hard requirements)

These are pass/fail. Violating any one invalidates the submission.

| Constraint | Detail |
|---|---|
| **Live external data** | The system must be ingesting real data from live external sources and working at the moment of evaluation. |
| **Gemini Flash only** | All AI tasks must use Google Gemini Flash. **The Claude API must not be used anywhere in the application.** No Anthropic SDK, no Anthropic API keys, no Anthropic endpoints in application code or dependencies. |
| **Vercel deployment** | Deployed on Vercel with a working public URL. |
| **Deliverables** | Public URL + GitHub repository link + Components Map. |

The Components Map is produced separately and is out of scope for this document, but the codebase must be organised so that a clean component map can be derived from it: one module per pipeline stage, clear boundaries, named exports.

---

## 3. Goals, non-goals, success criteria

### 3.1 Goals

1. Ingest Indian startup funding announcements and related ecosystem events from a broad set of live public sources, continuously.
2. Convert unstructured articles into a clean, deduplicated, structured, provenance-carrying deal database.
3. Rank every deal against a user-editable investment mandate, with a transparent and inspectable scoring rubric.
4. Detect statistically-gated patterns across deal flow and narrate them with cited evidence.
5. Detect and alert on competitive adjacency to the user's portfolio companies.
6. Deliver a scheduled digest (weekly or daily) by email, plus a live dashboard, explorer and analysis surfaces.
7. Generalise to any fund via multiple configurable profiles.

### 3.2 Non-goals (explicitly out of scope for v1)

- Multi-user authentication, teams, permissions, comments
- CRM integration (Affinity, Salesforce, Attio)
- Paid data sources (Crunchbase API, Tracxn API, PitchBook)
- Growth signals requiring paid or scraped data (web traffic, headcount tracking, patent filings)
- Email-based source ingestion (documented as roadmap only — see §27)
- Mobile native apps
- Chrome extension / MCP server
- Full-text article archival beyond the extraction window

### 3.3 Success criteria

The build is successful when all of the following are demonstrably true on the deployed URL:

| # | Criterion | How it is verified |
|---|---|---|
| S1 | ≥ 12 weeks of historical deal data in the database | Health page funnel + trends chart spanning 12 weeks |
| S2 | ≥ 150 unique deduplicated deals | Explorer total count |
| S3 | Live collection has run successfully within the last 24 hours | Health page `last_run_at` |
| S4 | Every deal displays ≥ 1 clickable source link | Visual inspection of any deal card |
| S5 | Changing mandate config visibly reorders the brief | Settings → edit sector → Regenerate → ranking changes |
| S6 | Switching profile produces a materially different brief from the same week's data | Profile switcher demo |
| S7 | At least one pattern fires with cited supporting deals | Current digest's Patterns section |
| S8 | At least one portfolio adjacency is detected and explained | Portfolio screen |
| S9 | The methodology page renders the live scoring rubric | `/methodology` |
| S10 | A digest email has been delivered and is viewable | Email inbox + digest archive |
| S11 | Both daily and weekly templates render correctly | Preview endpoint for each |
| S12 | Deduplication is demonstrable | Health page shows articles → deals → post-dedupe funnel with a real reduction |

---

## 4. Users and profiles

### 4.1 Primary persona

**Aarav** — venture scout, single-family office, Bengaluru. Backs early-stage Indian startups. Reads on a phone before opening his laptop. Repeats numbers from the brief to LPs and to his principals, so every figure must be traceable. Acts on the brief by emailing founders and flagging portfolio companies.

### 4.2 Profile system

The problem statement does not specify Aarav's sectors, stages or portfolio. **These are assumed, documented as assumptions, seeded as defaults, and fully user-editable.** The product tagline in the problem statement includes "SaaS-able", so the system supports multiple profiles over one shared data layer.

Three profiles ship seeded:

| Profile ID | Description | Purpose |
|---|---|---|
| `aarav-familyoffice` | Generalist Bengaluru family office, Pre-seed→Series A, six core sectors | The primary persona |
| `fintech-seed-fund` | Fintech-only, Seed-only, Mumbai-weighted, $500K–2M | Demonstrates personalisation |
| `consumer-syndicate` | D2C + quick commerce, Angel/Pre-seed, sub-$500K | Demonstrates personalisation |

The same week of raw data must produce three materially different briefs. This is a demo requirement, not a nice-to-have.

---

## 5. Technology stack (locked)

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js (App Router), TypeScript** | Server actions and route handlers for the pipeline |
| Hosting | **Vercel** | Required by the examination |
| Database | **Neon Postgres** | With **pgvector extension enabled** |
| ORM | **Drizzle ORM** | Lighter cold starts than Prisma; typed SQL for aggregates |
| DB driver | **`@neondatabase/serverless`** (HTTP) | **Not** node-postgres TCP — serverless functions exhaust TCP pools |
| AI | **Google Gemini Flash** via `@google/generative-ai` | Verify current model ID (e.g. a `gemini-*-flash` model) in Google AI Studio before use |
| Embeddings | **Gemini embedding model** | Verify current model ID. Must be Google, not Anthropic or OpenAI |
| Email | **Resend** | Transactional + digest delivery |
| Email templates | **React Email** | Renders to HTML, previewable locally |
| Validation | **Zod** | At every boundary |
| Charts | **Recharts** | Visual design pass deferred (see §18.6) |
| Styling | **Tailwind CSS** | Neutral system for v1; polish pass at the end |
| Scheduling | **Vercel Cron** | One daily cron, profile-aware dispatch (see §21) |

### 5.1 Platform limits to design around

**Verify all of these against current Vercel documentation before building — they change.**

- Vercel Hobby tier historically restricts cron frequency (commonly to once per day). **Design assumption: exactly one cron entry is available.** All scheduling is handled inside that one invocation by a dispatcher (§21).
- Serverless function execution time is capped. **Design assumption: no single invocation may exceed 60 seconds.** Every pipeline stage must be chunked, resumable, and safe to re-run.
- Neon free tier has compute-hour and storage limits. Keep `raw_articles` body text pruned after a retention window (§7.3).

**Design consequence:** the pipeline is a set of small, idempotent, independently-invocable stages that advance a job's state in the database. It is never a single long-running request.

---

## 6. System architecture

### 6.1 Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│  INGESTION                                                          │
│  Source Registry → Fetchers (RSS / HTML / News API) → raw_articles  │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE A · FILTER      cheap classifier: is this an Indian startup  │
│                        funding / M&A / fund-close / people event?   │
│                        kills ~80% of volume before expensive work   │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE B · EXTRACT     Gemini Flash → strict JSON schema            │
│                        → candidate deal / event records             │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE C · NORMALIZE   currency, stage enum, company name, dates,   │
│                        sector taxonomy mapping                      │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE D · DEDUPE      4 layers: domain → fuzzy name → vector →     │
│                        Gemini adjudication. Merge, union sources.   │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE E · ENRICH      embeddings, company linking, prior rounds,   │
│                        investor canonicalisation                    │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE F · SCORE       per profile: relevance rubric + adjacency    │
│                        detection → relevance_scores, adjacency_edges│
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE G · AGGREGATE   deterministic SQL: counts, deltas, medians,  │
│                        percentiles, leaderboards. NO LLM HERE.      │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE H · DETECT      12 pattern detectors with 3 gates each       │
│                        → patterns table                             │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE I · NARRATE     Gemini Flash reads AGGREGATES + FIRED        │
│                        PATTERNS (never raw deal lists) → prose      │
│                        with mandatory evidence_ids[]                │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE J · DELIVER     digest record → email (Resend) + web +       │
│                        alerts engine (separate, event-driven)       │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 The central architectural rule

> **Statistics are computed in SQL. The LLM interprets numbers; it never discovers them.**

Gemini has exactly four jobs in this system:

| Job | Stage | Input | Output |
|---|---|---|---|
| Classify | A | Article headline + lead | `is_relevant_event`, `event_type` |
| Extract | B | Article text | Structured record per JSON schema |
| Adjudicate | D, F | Two records / a deal + a portfolio company | Boolean + relationship + confidence |
| Narrate | I | Aggregate tables + fired patterns | Prose with cited evidence |

Gemini is **never** asked to "find trends", "summarise the week", or "tell me what's interesting" from a raw list. Doing so produces confident fabrications and is a build failure.

### 6.3 Repository structure

```
/
├── CLAUDE.md                    # engineering rules — always loaded
├── README.md                    # setup, architecture, assumptions, limitations
├── DECISIONS.md                 # running log of implementation decisions
├── docs/
│   ├── PRD.md                   # this file
│   └── COMPONENTS_MAP.md        # produced at the end
├── drizzle/                     # migrations
├── prompts/                     # versioned Gemini prompts, one file each
│   ├── classify.v1.md
│   ├── extract-deal.v1.md
│   ├── extract-event.v1.md
│   ├── dedupe-adjudicate.v1.md
│   ├── sector-fit.v1.md
│   ├── adjacency.v1.md
│   ├── narrate-weekly.v1.md
│   ├── narrate-daily.v1.md
│   ├── cluster-label.v1.md
│   └── deep-dive.v1.md
├── seed/
│   ├── profile-aarav.json
│   ├── profile-fintech-seed-fund.json
│   ├── profile-consumer-syndicate.json
│   ├── sources.json
│   └── sector-taxonomy.json
├── src/
│   ├── app/
│   │   ├── (dashboard)/         # web UI routes
│   │   └── api/
│   │       ├── cron/            # dispatcher + stage endpoints
│   │       ├── digest/
│   │       ├── deals/
│   │       ├── profile/
│   │       └── health/
│   ├── db/
│   │   ├── schema.ts
│   │   ├── client.ts
│   │   └── queries/             # one file per aggregate family
│   ├── pipeline/
│   │   ├── ingest/
│   │   ├── filter.ts
│   │   ├── extract.ts
│   │   ├── normalize.ts
│   │   ├── dedupe.ts
│   │   ├── enrich.ts
│   │   ├── score.ts
│   │   ├── aggregate.ts
│   │   ├── detect/              # one file per detector
│   │   ├── narrate.ts
│   │   └── deliver.ts
│   ├── lib/
│   │   ├── gemini.ts            # single wrapper: schema, retry, logging
│   │   ├── fx.ts
│   │   ├── taxonomy.ts
│   │   └── logger.ts
│   ├── emails/
│   │   ├── WeeklyDigest.tsx
│   │   ├── DailyDigest.tsx
│   │   └── Alert.tsx
│   └── scripts/
│       └── backfill.ts
└── tests/
```

---

## 7. Data model

Full Drizzle schema. All tables carry `created_at` and `updated_at` unless stated.

### 7.1 Core entities

```sql
-- Investment mandates. Multiple supported.
profiles (
  id                  text PRIMARY KEY,
  display_name        text NOT NULL,
  fund_type           text,
  config              jsonb NOT NULL,        -- full mandate object, see §8
  is_default          boolean DEFAULT false,
  last_digest_sent_at timestamptz,           -- CRITICAL: digest window anchor
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
)

-- Source registry. Drives ingestion; powers the health page.
sources (
  id              serial PRIMARY KEY,
  name            text NOT NULL,
  type            text NOT NULL,             -- 'rss' | 'html' | 'newsapi' | 'manual'
  url             text NOT NULL,
  tier            int  NOT NULL,             -- 1 | 2 | 3
  parser          text NOT NULL,             -- parser module key
  enabled         boolean DEFAULT true,
  last_fetched_at timestamptz,
  last_status     text,                      -- 'ok' | 'error' | 'empty'
  last_error      text,
  success_count   int DEFAULT 0,
  failure_count   int DEFAULT 0
)

-- Raw fetched content, before extraction. Enables prompt replay without re-crawling.
raw_articles (
  id              serial PRIMARY KEY,
  source_id       int REFERENCES sources(id),
  url             text NOT NULL,
  url_hash        text NOT NULL UNIQUE,      -- sha256(normalized url) — dedupe key
  headline        text,
  author          text,
  published_at    timestamptz,
  fetched_at      timestamptz DEFAULT now(),
  body_text       text,
  categories      text[],
  filter_verdict  text,                      -- 'relevant' | 'irrelevant' | 'pending'
  event_type_guess text,
  processed_at    timestamptz,
  run_id          text
)
```

> **Important ingestion note:** some RSS feeds emit a constant or malformed `guid` across all items. **Always key article identity on a normalised `url` hash, never on feed `guid`.** Keying on `guid` will silently drop items from such feeds.

### 7.2 Companies, investors, deals

```sql
companies (
  id                  serial PRIMARY KEY,
  canonical_name      text NOT NULL,
  normalized_name     text NOT NULL,         -- lowercase, legal suffixes stripped
  aliases             text[],
  domain              text,                  -- strongest dedupe key when present
  description         text,                  -- one line, Gemini-generated
  sector_primary      text,
  sub_sector          text,
  business_model      text,                  -- B2B | B2C | B2B2C | marketplace | SaaS | D2C
  hq_city             text,
  hq_state            text,
  founded_year        int,
  embedding           vector(768),           -- match your embedding model's dimension
  first_seen_at       timestamptz,
  last_event_at       timestamptz,
  UNIQUE(normalized_name, hq_city)
)
CREATE INDEX ON companies USING hnsw (embedding vector_cosine_ops);

investors (
  id              serial PRIMARY KEY,
  canonical_name  text NOT NULL UNIQUE,
  normalized_name text NOT NULL,
  aliases         text[],
  investor_type   text,                      -- VC | angel | family_office | CVC | PE | accelerator
  first_seen_at   timestamptz,
  deal_count      int DEFAULT 0,             -- denormalised, recomputed nightly
  total_deployed_usd numeric
)

deals (
  id                    text PRIMARY KEY,    -- deterministic: hash(normalized_name|stage|iso_week)
  company_id            int REFERENCES companies(id),
  round_stage           text NOT NULL,       -- canonical enum, see §9.3
  stage_raw             text,
  amount_raw            text,
  amount_usd            numeric,
  amount_inr            numeric,
  amount_confidence     text,                -- 'reported' | 'estimated' | 'undisclosed'
  fx_rate_used          numeric,
  fx_rate_date          date,
  announced_date        date NOT NULL,
  iso_week              text,                -- '2026-W41' — the aggregation key
  sector_primary        text NOT NULL,
  sector_secondary      text[],
  sub_sector            text,
  hq_city               text,
  valuation_usd         numeric,             -- nullable, rarely available
  prior_round_stage     text,                -- from "has raised X to date" mentions
  prior_round_date      date,
  corroboration_count   int DEFAULT 1,
  extraction_confidence numeric,             -- 0..1
  is_verified           boolean DEFAULT false, -- >=2 sources agree on amount AND stage
  has_disputed_field    boolean DEFAULT false,
  disputed_fields       text[],
  ingestion_mode        text NOT NULL,       -- 'live' | 'backfill' | 'manual'
  backfill_source       text,
  run_id                text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
)
CREATE INDEX ON deals (announced_date DESC);
CREATE INDEX ON deals (iso_week);
CREATE INDEX ON deals (sector_primary, announced_date DESC);
CREATE INDEX ON deals (round_stage, sector_primary);

deal_sources (
  deal_id       text REFERENCES deals(id) ON DELETE CASCADE,
  raw_article_id int REFERENCES raw_articles(id),
  publication   text NOT NULL,
  url           text NOT NULL,
  headline      text,
  published_at  timestamptz,
  is_primary    boolean DEFAULT false,       -- earliest published
  PRIMARY KEY (deal_id, raw_article_id)
)

deal_investors (
  deal_id     text REFERENCES deals(id) ON DELETE CASCADE,
  investor_id int REFERENCES investors(id),
  role        text NOT NULL,                 -- 'lead' | 'participating' | 'existing'
  PRIMARY KEY (deal_id, investor_id, role)
)
CREATE INDEX ON deal_investors (investor_id);
```

### 7.3 Non-funding events

```sql
events (
  id            text PRIMARY KEY,
  event_type    text NOT NULL,   -- 'ma' | 'shutdown' | 'ipo_filing' | 'layoff'
                                 -- | 'people_move' | 'fund_close' | 'financial_result'
  company_id    int REFERENCES companies(id),
  counterparty_company_id int REFERENCES companies(id),  -- acquirer, for M&A
  headline      text NOT NULL,
  detail        text,
  amount_usd    numeric,
  event_date    date NOT NULL,
  iso_week      text,
  sector_primary text,

  -- people_move specific
  person_name   text,
  person_role   text,
  move_type     text,            -- 'joined' | 'departed' | 'promoted' | 'founded'
  from_company  text,
  to_company    text,

  -- fund_close specific
  fund_name     text,
  fund_size_usd numeric,
  fund_vintage  int,
  stated_focus  text[],

  corroboration_count int DEFAULT 1,
  ingestion_mode text NOT NULL,
  run_id        text,
  created_at    timestamptz DEFAULT now()
)
CREATE INDEX ON events (event_type, event_date DESC);
CREATE INDEX ON events (iso_week);

event_sources (
  event_id      text REFERENCES events(id) ON DELETE CASCADE,
  raw_article_id int REFERENCES raw_articles(id),
  publication   text,
  url           text NOT NULL,
  is_primary    boolean DEFAULT false,
  PRIMARY KEY (event_id, raw_article_id)
)
```

### 7.4 Mandate, scoring, patterns

```sql
watchlist (
  id          serial PRIMARY KEY,
  profile_id  text REFERENCES profiles(id) ON DELETE CASCADE,
  watch_type  text NOT NULL,       -- 'company' | 'investor' | 'sector' | 'keyword'
  value       text NOT NULL,
  normalized_value text NOT NULL,
  aliases     text[],
  company_id  int REFERENCES companies(id),   -- resolved if matched
  investor_id int REFERENCES investors(id),
  notes       text,
  tags        text[],
  alerts_enabled boolean DEFAULT true,
  status      text DEFAULT 'watching',        -- watching | raised | acquired | dormant
  last_event_at timestamptz,
  added_at    timestamptz DEFAULT now(),
  UNIQUE(profile_id, watch_type, normalized_value)
)

portfolio (
  id            serial PRIMARY KEY,
  profile_id    text REFERENCES profiles(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text NOT NULL,      -- drives adjacency; must be specific
  sector        text NOT NULL,
  sub_sector    text,
  stage_held    text,
  city          text,
  invested_at   date,
  adjacency_keywords text[] NOT NULL,  -- 6-8 specific phrases, see §13.1
  embedding     vector(768),
  is_active     boolean DEFAULT true
)
CREATE INDEX ON portfolio USING hnsw (embedding vector_cosine_ops);

relevance_scores (
  deal_id     text REFERENCES deals(id) ON DELETE CASCADE,
  profile_id  text REFERENCES profiles(id) ON DELETE CASCADE,
  score       numeric NOT NULL,
  tier        text NOT NULL,        -- 'act_now' | 'high' | 'relevant' | 'context' | 'archive'
  breakdown   jsonb NOT NULL,       -- full component-by-component scorecard, see §11.5
  reason      text NOT NULL,        -- human-readable one-liner
  is_serendipity boolean DEFAULT false,
  computed_at timestamptz DEFAULT now(),
  PRIMARY KEY (deal_id, profile_id)
)
CREATE INDEX ON relevance_scores (profile_id, score DESC);

adjacency_edges (
  id             serial PRIMARY KEY,
  profile_id     text REFERENCES profiles(id) ON DELETE CASCADE,
  portfolio_id   int REFERENCES portfolio(id) ON DELETE CASCADE,
  deal_id        text REFERENCES deals(id) ON DELETE CASCADE,
  relationship   text NOT NULL,     -- 'competitor' | 'same_layer' | 'supplier'
                                    -- | 'customer' | 'complement'
  confidence     numeric NOT NULL,  -- 0..1
  rationale      text NOT NULL,     -- one sentence from Gemini
  vector_similarity numeric,
  detected_at    timestamptz DEFAULT now(),
  UNIQUE(portfolio_id, deal_id)
)

patterns (
  id            serial PRIMARY KEY,
  profile_id    text REFERENCES profiles(id),
  iso_week      text NOT NULL,
  detector_key  text NOT NULL,      -- 'sector_momentum' | 'investor_rotation' | ...
  title         text NOT NULL,
  statement     text NOT NULL,      -- includes the statistic
  confidence    text NOT NULL,      -- 'strong' | 'emerging' | 'weak_signal'
  sample_size   int NOT NULL,
  effect_size   numeric,            -- sigma or % change
  stat_basis    jsonb NOT NULL,     -- the actual numbers used
  evidence_deal_ids  text[],
  evidence_event_ids text[],
  consecutive_weeks  int DEFAULT 1, -- enables "third consecutive week"
  created_at    timestamptz DEFAULT now(),
  UNIQUE(profile_id, iso_week, detector_key)
)

market_map_clusters (
  id            serial PRIMARY KEY,
  sector        text NOT NULL,
  cluster_label text NOT NULL,      -- Gemini-generated
  company_ids   int[],
  deal_count    int,
  total_capital_usd numeric,
  top_investors text[],
  centroid      vector(768),
  computed_at   timestamptz DEFAULT now()
)
```

### 7.5 Delivery and operations

```sql
digests (
  id            serial PRIMARY KEY,
  profile_id    text REFERENCES profiles(id),
  mode          text NOT NULL,        -- 'weekly' | 'daily'
  window_start  timestamptz NOT NULL,
  window_end    timestamptz NOT NULL,
  iso_week      text,
  headline      text NOT NULL,        -- becomes the email subject
  tldr          jsonb NOT NULL,       -- array of bullet strings
  narrative     jsonb NOT NULL,       -- array of {claim, evidence_ids, confidence, stat_basis}
  aggregates    jsonb NOT NULL,       -- the full computed stats blob
  share_token   text UNIQUE,          -- public read-only link
  email_sent_at timestamptz,
  email_status  text,
  generated_at  timestamptz DEFAULT now()
)

digest_items (
  digest_id   int REFERENCES digests(id) ON DELETE CASCADE,
  deal_id     text REFERENCES deals(id),
  event_id    text REFERENCES events(id),
  section     text NOT NULL,          -- 'watchlist' | 'adjacency' | 'ranked' | 'outside_mandate'
                                      -- | 'exits' | 'fund_closes' | 'people' | 'investors'
  rank        int,
  PRIMARY KEY (digest_id, COALESCE(deal_id, ''), COALESCE(event_id, ''), section)
)

alerts (
  id            serial PRIMARY KEY,
  profile_id    text REFERENCES profiles(id),
  severity      text NOT NULL,        -- 'critical' | 'high' | 'medium' | 'info'
  trigger_key   text NOT NULL,        -- see §15.1
  portfolio_id  int REFERENCES portfolio(id),
  watchlist_id  int REFERENCES watchlist(id),
  deal_id       text REFERENCES deals(id),
  event_id      text REFERENCES events(id),
  title         text NOT NULL,
  body          text NOT NULL,
  dedupe_key    text NOT NULL UNIQUE, -- prevents double-fire, see §15.2
  status        text DEFAULT 'pending', -- pending | queued | sent | suppressed | batched
  suppressed_reason text,
  created_at    timestamptz DEFAULT now(),
  sent_at       timestamptz
)

run_logs (
  id            serial PRIMARY KEY,
  run_id        text NOT NULL,
  stage         text NOT NULL,
  started_at    timestamptz NOT NULL,
  finished_at   timestamptz,
  status        text NOT NULL,        -- 'running' | 'ok' | 'partial' | 'error'
  items_in      int,
  items_out     int,
  gemini_calls  int,
  gemini_tokens int,
  error         text,
  detail        jsonb
)

quarantine (
  id            serial PRIMARY KEY,
  stage         text NOT NULL,
  raw_article_id int,
  payload       jsonb,
  error         text NOT NULL,
  run_id        text,
  created_at    timestamptz DEFAULT now()
)

fx_rates (
  date      date PRIMARY KEY,
  usd_inr   numeric NOT NULL,
  source    text NOT NULL
)
```

### 7.6 Retention

- `raw_articles.body_text` is nulled out 30 days after `processed_at`. Metadata and URLs are kept forever.
- Nothing else is deleted. Soft deletes only (`is_active` / `status` flags).

---

## 8. The mandate config object

Stored in `profiles.config` as JSONB. This is the complete shape. Seeded from `seed/profile-*.json`.

```jsonc
{
  "assumption_note": "Mandate inferred from the problem statement. All values user-editable.",

  "mandate": {
    "country": "India",
    "geographies_primary": ["Bengaluru", "Delhi-NCR", "Mumbai"],
    "geographies_secondary": ["Pune", "Hyderabad", "Chennai", "Ahmedabad"],
    "stages": ["Pre-seed", "Seed", "Pre-Series A", "Series A"],
    "stages_adjacent": ["Angel", "Bridge", "Series B"],
    "cheque_size_usd": { "min": 250000, "max": 3000000 },
    "round_size_interest_usd": { "min": 500000, "max": 20000000 }
  },

  "sectors_core": [ { "name": "...", "sub": ["..."] } ],
  "sectors_watch": ["..."],
  "sectors_excluded": ["..."],
  "keywords_excluded": ["..."],

  "scoring_weights": {
    "sector_fit": 30,
    "stage_fit": 20,
    "cheque_fit": 10,
    "tracked_investor": 12,
    "geography_fit": 5,
    "recency": 5,
    "ecosystem_significance": 18,
    "override_watchlist": 40,
    "override_adjacency_competitor": 35,
    "override_adjacency_same_layer": 25,
    "override_adjacency_adjacent": 15,
    "override_investor_first_move": 10,
    "confidence_discount_single_source": 0.85
  },

  "tier_thresholds": { "act_now": 80, "high": 60, "relevant": 40, "context": 20 },

  "serendipity": { "enabled": true, "count": 3, "max_mandate_score": 40 },

  "delivery": {
    "mode": "weekly",                  // "weekly" | "twice_weekly" | "daily" | "custom"
    "days": ["monday"],                // subset of mon..sun
    "send_hour": "06:30",
    "timezone": "Asia/Kolkata",
    "recipients": ["aarav@example-familyoffice.com"],
    "min_deals_to_send": 1
  },

  "alerts": {
    "enabled": true,
    "severity_threshold": "high",
    "quiet_hours": ["22:00", "07:00"],
    "max_immediate_per_day": 3,
    "cluster_window_days": 14,
    "cluster_threshold": 2,
    "triggers_enabled": {
      "competitor_raise": true,
      "watchlist_raise": true,
      "same_layer_raise": true,
      "portfolio_mentioned": true,
      "adjacency_cluster": true,
      "sector_momentum_flip": true,
      "competitor_acquired": true,
      "competitor_shutdown": true
    }
  }
}
```

### 8.1 Seeded profile — `aarav-familyoffice`

The full seed file is provided in `seed/profile-aarav.json`. Key assumed values:

**Core sectors (6):** Fintech (SME lending, embedded finance, wealthtech, B2B payments, insurtech) · B2B SaaS (vertical SaaS, devtools, AI-native SaaS, revenue ops, compliance tech) · Supply Chain & Logistics (B2B commerce, freight & trucking, warehousing, procurement, cross-border) · Healthtech (diagnostics, care delivery, health SaaS, mental health, pharma supply) · AI Applications (applied AI, AI agents, vernacular AI, AI infrastructure, document AI) · Consumer & D2C (premium F&B, personal care, creator economy, quick commerce)

**Watch sectors:** Climate & Energy · Agritech · Deeptech & Space

**Excluded:** Real-money gaming · Crypto/Web3 tokens · K-12 Edtech

**Portfolio (6 real companies, tracked as simulated holdings — see §8.2):**

| Name | Sector | Description | Assumed stage held | City |
|---|---|---|---|---|
| Khatabook | B2B SaaS | Digital ledger and bookkeeping app for Indian SMEs, kirana stores and small merchants, with credit and payments layered on top. | Seed | Bengaluru |
| Rupifi | Fintech | Embedded B2B credit and buy-now-pay-later rails that marketplaces and distributors plug in for their merchant buyers. | Series A | Bengaluru |
| Bizongo | Supply Chain & Logistics | B2B vendor digitisation and supply-chain platform for packaging and raw materials, with embedded supply-chain financing. | Pre-Series A | Mumbai |
| Even Healthcare | Healthtech | Health membership combining managed primary care with hospitalisation cover and care coordination. | Seed | Bengaluru |
| Sarvam AI | AI Applications | Indic-language foundation models and the applications built on them for Indian enterprises and government. | Pre-seed | Bengaluru |
| The Whole Truth Foods | Consumer & D2C | Clean-label packaged foods and protein snacking, sold D2C and through quick commerce. | Seed | Mumbai |

Each carries 6–8 **specific** `adjacency_keywords`. Starting sets:

| Company | `adjacency_keywords` |
|---|---|
| Khatabook | SME bookkeeping · digital ledger · kirana tech · merchant software · GST compliance · small business accounting |
| Rupifi | embedded finance · B2B BNPL · working capital · supply chain finance · lending API · merchant credit |
| Bizongo | B2B commerce · vendor digitisation · packaging procurement · raw material sourcing · supply chain financing · industrial marketplace |
| Even Healthcare | health membership · primary care · managed care · health insurance alternative · care coordination · preventive health |
| Sarvam AI | Indic language models · foundation models · vernacular AI · AI agents · sovereign AI · Indian language NLP |
| The Whole Truth Foods | clean label · packaged food · protein snacking · D2C food brand · healthy snacking · quick commerce brand |

> **Implementation note:** real companies evolve and pivot. Before seeding, verify each description against the company's current public positioning and adjust it. A stale description produces wrong adjacency matches, which is worse than no matches.

**Watchlist companies (real, 12):** Recur Club · Jai Kisan · Vegrow · FarMart · Zolve · Wysa · Dukaan · Jar · CoRover · Zetwerk · Ultrahuman · Wakefit

**Watchlist investors (real, 10):** Blume Ventures · Accel India · Peak XV Partners · Elevation Capital · Prime Venture Partners · India Quotient · 3one4 Capital · Together Fund · Stellaris Venture Partners · All In Capital

Portfolio and watchlist entries **must not overlap** — a company is tracked in one role or the other, never both. Enforce this at seed time and in the settings UI.

### 8.2 Portfolio framing and required disclosure

The portfolio uses **real Indian companies treated as simulated holdings**. Aarav is a fictional persona taken from the examination problem statement. No fund, no investment and no relationship between him, this project and these companies exists.

**This disclosure must appear verbatim in the README, on `/methodology`, and as a non-dismissible banner on `/portfolio`:**

> **Simulated portfolio.** Aarav is a fictional persona from the assigned problem statement. The companies listed as portfolio holdings are real Indian startups, used so that competitive-adjacency detection can be verified against companies a reader recognises. **No investment, advisory or commercial relationship between this project, the persona and these companies is implied or asserted.** Watchlist entries are companies and funds being monitored, which likewise implies no relationship.

Rules the implementation must follow:

1. `stage_held` is labelled **"Assumed stage held"** in every UI surface — never "Invested at", "Our stake", or "Holding".
2. Each portfolio row carries `relationship_type: "simulated_holding"` in config; the UI reads its label from that field rather than hardcoding one.
3. The `/portfolio` disclosure banner is not dismissible.
4. Digest emails carry a one-line footer version of the disclosure.
5. **No generated narrative, alert, or LP talking point may describe the fund as owning, having invested in, or holding a stake in these companies.** The narration and alert prompts must instruct Gemini to use "tracked company" or "portfolio company (simulated)" phrasing, and the constraint is stated in the prompt files.

**Why real companies:** adjacency operates on descriptions and embeddings, so invented companies would function identically — but real ones make the output *verifiable*. An evaluator can check that a flagged competitor genuinely competes with a company they recognise. The trade-off is that the five disclosure rules above become mandatory rather than optional.

**Second-order benefit:** because these are real companies, the `portfolio_mentioned` alert trigger can genuinely fire during the evaluation window if one of them raises, is acquired, or appears in the news — a live demonstration that invented companies could never produce.

---

## 9. Ingestion

### 9.1 Source registry

Seeded from `seed/sources.json`. All sources are configuration rows, never hardcoded fetchers.

**Tier 1 — Indian startup media (RSS where available, HTML fallback):**

| Name | Approach |
|---|---|
| Entrackr | RSS + weekly funding report archive (critical for backfill — see §19) |
| Inc42 | RSS + funding tracker pages |
| YourStory | RSS |
| VCCircle | RSS |
| Moneycontrol — Startups | RSS |
| Economic Times Tech | RSS |
| Business Standard — Companies/Startups | RSS |
| Techcircle | RSS |
| The CapTable | RSS |

**Tier 2 — News APIs (breadth, to catch what Tier 1 misses):**

Use a free-tier news API (GNews, NewsAPI, or Google News RSS query endpoints — verify current free-tier terms and limits). Run **multiple structured queries**, not one:

- `India startup raises funding`
- `Indian startup "Series A" OR "Series B" raises`
- `India startup seed round million`
- Per-sector: `India fintech startup raises`, `India SaaS startup funding`, etc. (one per core sector)
- `India startup acquires OR acquisition`
- `India venture fund closes OR "new fund"`

**Tier 3 — Manual add.** A form in the UI where a URL or a typed deal is submitted. Flows through the same pipeline with `ingestion_mode: 'manual'`. Low effort, high realism — scouts hear things before they're published.

**Not in scope:** paywalled sources, social media scraping, email ingestion.

### 9.2 Fetching rules

- One parser module per source `type`; the registry's `parser` key selects it
- Per-source rate limiting and exponential backoff on failure
- **Article identity is `sha256(normalized_url)`**, stored in `raw_articles.url_hash` with a unique constraint. Never use feed `guid` — some feeds emit a constant or malformed guid for every item, which silently drops them all.
- URL normalisation: strip `utm_*` and other tracking params, lowercase host, remove trailing slash, resolve to canonical if `<link rel="canonical">` is present
- Store `body_text` where the feed or page provides it; a teaser-only feed still yields a usable record (headline + lead often contain company, amount and stage)
- Never fetch content blocked by the source's `robots.txt`; respect it
- A source that fails updates `last_status` and `last_error` and **does not fail the run**

### 9.3 Canonical enums

**Round stages (ordered):**
`Angel` → `Pre-seed` → `Seed` → `Pre-Series A` → `Series A` → `Series B` → `Series C` → `Series D+` → `Growth` → `Pre-IPO`
Plus non-ordinal: `Bridge`, `Debt`, `Grant`, `Undisclosed`

Stage distance for scoring is computed on the ordered list; non-ordinal stages map to the nearest equity stage mentioned, else score 0.

**Sector taxonomy:** a fixed list of ~20 sectors in `seed/sector-taxonomy.json`. Gemini must map into this list. Free-text sectors destroy aggregation and are rejected at validation.

Suggested list: Fintech · B2B SaaS · Consumer Internet · D2C & Commerce · Quick Commerce · Supply Chain & Logistics · Healthtech · Edtech · AI Applications · AI Infrastructure · Deeptech · Spacetech · Climate & Energy · Agritech · Mobility & EV · Real Estate & Proptech · HR Tech · Gaming · Media & Content · Enterprise Services · Other

---

## 10. Pipeline stages

Every stage: idempotent, chunked, resumable, logs to `run_logs`, writes failures to `quarantine`.

### Stage A — Filter

**Input:** `raw_articles` where `filter_verdict = 'pending'`
**Method:** keyword prefilter in SQL, then one batched Gemini call per 20 articles over headline + first 300 chars.
**Output schema:**
```json
{ "results": [ { "article_id": 0, "is_relevant": true, "event_type": "funding",
                 "confidence": 0.0, "reason": "" } ] }
```
`event_type` ∈ the `events.event_type` enum plus `funding` and `none`.
**Effect:** ~80% of articles are rejected here, before expensive extraction.

### Stage B — Extract

**Input:** `raw_articles` where `filter_verdict = 'relevant'` and `processed_at IS NULL`
**Method:** batched Gemini calls (5–10 articles each), `responseMimeType: application/json`, strict `responseSchema`, `temperature: 0.1`.

Two schemas: one for `funding`, one for everything else (`events`).

**Funding schema (fields):** `company_name`, `company_aliases[]`, `company_description`, `domain`, `round_stage`, `stage_raw`, `amount_raw`, `amount_value`, `amount_currency`, `amount_unit` (`crore`|`lakh`|`million`|`billion`|`absolute`), `amount_confidence`, `announced_date`, `sector_primary` (from taxonomy), `sector_secondary[]`, `sub_sector`, `business_model`, `hq_city`, `investors_lead[]`, `investors_participating[]`, `investors_existing[]`, `founders[]`, `founded_year`, `valuation_mentioned`, `prior_round_stage`, `prior_round_date`, `total_raised_to_date`, `extraction_confidence`.

**Critical prompt rules:**
- Every field is nullable. The instruction is explicit: **"Return null if the article does not state this. Do not infer, estimate or guess."**
- `sector_primary` must be one of the supplied taxonomy values, verbatim.
- `prior_round_stage` / `prior_round_date` / `total_raised_to_date` are extracted from the common "has raised $X to date, following a $Y seed in 2024" sentence. **This is required** — it seeds round-pair history for detector #7 (§14).

**Output:** rows written to a staging state; Zod-validated. Validation failures go to `quarantine`, never silently dropped.

### Stage C — Normalize

Deterministic code, no LLM.

1. **Currency.** `₹120 crore` → INR 1,200,000,000 → USD via `fx_rates` for `announced_date` (fallback: nearest prior date). Store `amount_usd`, `amount_inr`, `fx_rate_used`, `fx_rate_date`. Fetch daily USD/INR from a free FX API and cache in `fx_rates`.
2. **Stage.** Map `stage_raw` to the canonical enum via a lookup table plus regex. Unmapped → `Undisclosed`, logged for review.
3. **Company name.** Lowercase; strip `Pvt Ltd`, `Private Limited`, `Ltd`, `Inc`, `Technologies`, `Labs`, `India`; collapse whitespace and punctuation → `normalized_name`.
4. **Dates.** Relative expressions resolved against `published_at`. Future dates rejected.
5. **City.** Map variants (`Bangalore`/`Bengaluru`, `Gurgaon`/`Gurugram`/`Noida` → `Delhi-NCR`).
6. **Deal ID.** `sha256(normalized_name + '|' + round_stage + '|' + iso_week)` — deterministic, so re-runs are idempotent.

### Stage D — Deduplicate

Four layers, in order. Stop at the first confident match.

1. **Domain + stage + ±14 days.** Exact match → same deal.
2. **Normalized name exact + stage + ±14 days.** → same deal.
3. **Vector similarity.** Company embedding cosine > 0.88 **and** stage match **and** ±14 days → candidate.
4. **Gemini adjudication** for candidates with similarity 0.78–0.88, or name trigram similarity > 0.7. One call, both records supplied.
   Output: `{ "same_event": bool, "confidence": 0..1, "reason": "" }`

**On merge:**
- Keep the amount with the highest `amount_confidence`; on tie, the most-corroborated value
- If sources disagree on amount beyond 10%, set `has_disputed_field = true`, add `'amount'` to `disputed_fields`, and keep the range in `amount_raw`
- Union investor lists; a `lead` claim from any source wins over `participating`
- Append all `deal_sources`; the earliest `published_at` becomes `is_primary`
- `corroboration_count` = count of distinct publications
- `is_verified` = `corroboration_count >= 2 AND NOT has_disputed_field`

**Dedupe statistics must be recorded per run** and shown on the health page: articles in → candidate records → unique deals out.

### Stage E — Enrich

1. Generate or update company embedding from `description + sub_sector + business_model` using the Gemini embedding model.
2. Link to existing `companies` row (by domain, then normalized name, then vector).
3. Canonicalise investors: normalise names, merge known aliases (`Accel India` / `Accel Partners India` → `Accel India`). Maintain an alias table seeded with common Indian VC name variants.
4. Write `prior_round_stage` / `prior_round_date` back onto the company's history where extracted, so round-pair velocity (detector #7) has data even when the earlier round was never observed live.
5. Recompute `investors.deal_count` and `total_deployed_usd`.

### Stage F — Score

Per profile. See §11 (relevance) and §13 (adjacency).

### Stage G — Aggregate

Pure SQL, written as named query functions in `src/db/queries/`. **No LLM.** Outputs a typed `Aggregates` object consumed by both the dashboard and Stage I.

Computed per window (digest window) and per baseline (trailing 8 weeks):

- Deal count, total capital, median / mean cheque, undisclosed count
- Per sector: deal count, capital, share %, WoW delta, vs-8-week-mean delta in σ
- Per stage: count, capital, median cheque, share %, vs baseline
- Per city: count, capital, share %
- Investor leaderboard: deal count, capital deployed, sectors touched, stages, vs own trailing cadence
- Co-investment pairs with counts and lift (observed / expected)
- Capital concentration: top-3 share of window capital, vs baseline
- Cheque percentiles per (stage × sector) bucket
- Round-gap medians per (stage × sector) where round pairs exist
- Events: M&A count and volume, shutdowns, fund closes and total fund capital, people moves by type
- Market temperature index (§12.3)
- Coverage stats: sources polled, success rate, articles→deals funnel

**All aggregates carry their `n`.** Any downstream consumer must be able to see sample size.

### Stage H — Detect

See §14.

### Stage I — Narrate

**Input to Gemini:** the `Aggregates` object (as formatted tables), the fired `patterns` rows, and compact summaries of the top-ranked deals and flagged events. **Never the raw deal list without aggregates.**

**Output schema:**
```json
{
  "headline": "string, <= 90 chars, includes the key number",
  "tldr": ["3-5 bullet strings, each with a statistic"],
  "narrative": [
    { "claim": "one paragraph",
      "evidence_deal_ids": ["..."],
      "evidence_event_ids": ["..."],
      "confidence": "strong|emerging|weak_signal",
      "stat_basis": "the numbers this rests on" }
  ],
  "lp_talking_points": ["3-5 bullets suitable for forwarding"],
  "open_questions": ["2-3 things the data suggests but cannot confirm"]
}
```

`temperature: 0.35`. **Any narrative paragraph whose `evidence_deal_ids` and `evidence_event_ids` are both empty is rejected in code and not rendered.** This is enforced, not requested.

### Stage J — Deliver

See §16 (digest), §17 (email), §15 (alerts).

---

## 11. Relevance scoring rubric

This rubric is a **user-facing feature**, not an implementation detail. It is rendered live at `/methodology` and expandable on every deal card.

### 11.1 Base components (100 points)

| Component | Max | Computation | Deterministic? |
|---|---|---|---|
| **Sector fit** | 30 | Gemini returns `fit ∈ [0,1]` for the deal's sector+sub-sector against the mandate's core sectors → `× 30`. Exact primary ≈ 30, adjacent sub-sector ≈ 18, watch-sector ≈ 10, unrelated 0. Cached per (sector, sub_sector, profile) — do not re-call per deal. | Gemini (cached) |
| **Stage fit** | 20 | In `mandate.stages` → 20. In `stages_adjacent` or one step on the ordered enum → 10. Two steps → 4. Else 0. | Yes |
| **Cheque fit** | 10 | `amount_usd` within `round_size_interest_usd` → 10. Within ±50% of the band → 5. Outside → 0. `undisclosed` → 4 (neutral, never penalised). | Yes |
| **Tracked investor** | 12 | Any watchlist investor as `lead` → 12. As `participating` → 7. As `existing` → 4. Take the max. | Yes |
| **Geography fit** | 5 | `geographies_primary` → 5. `geographies_secondary` → 3. Other India → 1. | Yes |
| **Recency** | 5 | Linear decay across the digest window: newest = 5, oldest = 0. | Yes |
| **Ecosystem significance** | 18 | `0.5 × cheque_percentile(stage×sector)` + `0.3 × investor_tier_score` + `0.2 × min(corroboration_count/4, 1)`, × 18. **Mandate-independent** — this is what lets good deals surface from outside the mandate. | Yes |

`investor_tier_score`: computed from the investor's `deal_count` percentile in our own DB. No external ranking, no hardcoded tier list.

### 11.2 Overrides (applied after the base sum)

| Trigger | Effect |
|---|---|
| Deal company matches a `watchlist` company entry | `+40`, force into the `watchlist` section, always surfaces |
| Adjacency `relationship = 'competitor'` | `+35`, red flag |
| Adjacency `relationship = 'same_layer'` | `+25`, amber flag |
| Adjacency ∈ `{supplier, customer, complement}` | `+15`, blue flag |
| A watchlist investor made a **first move** in a mandate sector (per §14 detector 4 gating) | `+10` |
| Sector ∈ `sectors_excluded` or any `keywords_excluded` matched | **Hard filter.** Score 0, `tier = 'archive'`, excluded from all digest sections |
| `corroboration_count = 1` and `is_verified = false` | Multiply the final score by `confidence_discount_single_source` (0.85) |

Final score is clamped to `[0, 100]` for display; the raw pre-clamp value is kept in `breakdown`.

### 11.3 Tiers

| Score | Tier key | Label | Where it appears |
|---|---|---|---|
| ≥ 80 | `act_now` | 🔴 Act now | Top of digest; eligible for push alert |
| 60–79 | `high` | 🟠 High relevance | Main deal list |
| 40–59 | `relevant` | 🟡 Relevant | Main deal list |
| 20–39 | `context` | ⚪ Context | Collapsed section |
| < 20 | `archive` | — | Explorer only |

### 11.4 Serendipity Override

After ranking, select the top `serendipity.count` (default 3) deals that satisfy:

```
mandate_component_score < serendipity.max_mandate_score   (default 40)
AND ecosystem_significance in the top decile for the window
AND sector NOT IN sectors_excluded
```

Mark `relevance_scores.is_serendipity = true` and place them in a fixed digest section titled **"Outside your mandate, worth knowing."**

The methodology page must state, verbatim:

> *We deliberately surface the three most significant deals that did NOT match your mandate, because a perfect filter would recreate the blind spot this product exists to fix.*

### 11.5 The scorecard

Every deal stores and displays its full breakdown:

```json
{
  "total": 87,
  "tier": "act_now",
  "components": {
    "sector_fit":   { "points": 28, "max": 30, "detail": "Fintech → SME lending (primary match)" },
    "stage_fit":    { "points": 20, "max": 20, "detail": "Series A, in mandate" },
    "cheque_fit":   { "points": 10, "max": 10, "detail": "$8M, within $0.5–20M" },
    "tracked_investor": { "points": 12, "max": 12, "detail": "Blume Ventures (lead) — tracked" },
    "geography_fit":{ "points": 5,  "max": 5,  "detail": "Bengaluru" },
    "recency":      { "points": 4,  "max": 5,  "detail": "Announced 2 days ago" },
    "ecosystem_significance": { "points": 11, "max": 18, "detail": "78th pct cheque for Series A fintech" }
  },
  "overrides": [
    { "key": "adjacency_same_layer", "points": 25, "detail": "Same layer as Khatabook (tracked company)" }
  ],
  "confidence_multiplier": 1.0,
  "raw_total": 115,
  "clamped_total": 87
}
```

### 11.6 Weight tuning

Settings exposes a **Tune weights** panel. Changing a weight writes to `profiles.config.scoring_weights` and triggers a rescore of the current window. The methodology page renders from the live config, not from hardcoded values.

---

## 12. Aggregates and metrics

### 12.1 Window semantics — critical

The digest window is **`since last digest`**, not a fixed seven days.

```
window_start = profile.last_digest_sent_at ?? (now - 7 days)
window_end   = now
```

Weekly Monday mode → Mon-to-Mon. Thursday mode → Thu-to-Thu. Twice-weekly → Mon covers Thu–Sun, Thu covers Mon–Wed. Daily → 24 hours.

**Hardcoding seven days produces duplicate deals across consecutive sends.** `last_digest_sent_at` is written only after successful send.

### 12.2 Baseline

The trailing baseline is **fixed at 8 weeks regardless of delivery cadence**, so trend language stays comparable. Eight weeks matches the convention used in published Indian ecosystem reports, which makes the numbers externally checkable.

### 12.3 Market temperature index

A single 0–100 composite, shown as a KPI tile and tracked over time.

```
components (each z-scored against the trailing 8 weeks, then mapped to 0..100):
  0.35 × deal_count
  0.35 × total_capital
  0.15 × early_stage_share      (Pre-seed+Seed+Pre-A share of deals)
  0.15 × (1 - capital_concentration)   // broad participation = warmer
```

Display with the raw components on hover. Never display without the underlying numbers available.

---

## 13. Adjacency engine

This is the feature that answers the problem statement's defining failure. Build it well; demo it first.

### 13.1 Why `adjacency_keywords` matter

Each portfolio company carries 6–8 **specific** phrases. Generic terms like "fintech" match everything and produce a wall of false positives. Specific terms like "embedded finance", "BNPL B2B", "supply chain finance", "lending API", "merchant credit" produce precise matches.

The embedding for a portfolio company is generated from `description + adjacency_keywords.join(', ')`.

### 13.2 Two-phase detection

**Phase 1 — vector shortlist (cheap).** For each new deal, cosine-similarity its company embedding against all active portfolio embeddings for the profile. Keep pairs with similarity ≥ 0.72.

This is what makes the feature affordable. Without it you would run `deals × portfolio_companies` Gemini calls every run.

**Phase 2 — Gemini adjudication (precise).** For each shortlisted pair, one call:

Input: portfolio company name, description, keywords; deal company name, description, sector, sub-sector.

Output schema:
```json
{
  "is_related": true,
  "relationship": "competitor | same_layer | supplier | customer | complement | unrelated",
  "confidence": 0.0,
  "rationale": "one sentence, max 25 words, naming the specific overlap"
}
```

Write `adjacency_edges` for `is_related = true` and `confidence ≥ 0.6`.

**Relationship definitions, supplied in the prompt:**

| Value | Meaning |
|---|---|
| `competitor` | Sells substantially the same product to substantially the same customer |
| `same_layer` | Different product, same customer and same budget line — substitute risk |
| `supplier` | Sells into the portfolio company's stack |
| `customer` | Would buy from the portfolio company |
| `complement` | Expands the portfolio company's market without competing |

### 13.3 The cluster trigger — the board-meeting fix

Maintain a rolling counter per portfolio company:

```sql
SELECT portfolio_id, count(*) AS n
FROM adjacency_edges
WHERE profile_id = $1
  AND detected_at >= now() - (config.alerts.cluster_window_days || ' days')::interval
  AND relationship IN ('competitor','same_layer')
GROUP BY portfolio_id
HAVING count(*) >= config.alerts.cluster_threshold
```

When this fires, raise a `medium`-severity alert with `trigger_key = 'adjacency_cluster'`:

> *Two companies adjacent to {portfolio company} have raised in the last 14 days. {Deal A} and {Deal B}.*

**This is the exact scenario from the problem statement.** Put it first in the demo.

---

## 14. Pattern detection engine

### 14.1 The three-gate rule

Every detector must pass **all three** gates before it fires. Thresholds live in a config file, not inline.

```
fire IF  sample_size    >= n_min        // enough observations
    AND  effect_size    >= e_min        // the change is large enough to matter
    AND  baseline_weeks >= b_min        // enough history for the comparison to mean anything
```

The third gate is the one that silently breaks a young database. A detector whose `b_min` is unmet must be marked **suppressed** and shown as such on the methodology page — not silently absent.

### 14.2 Detector specifications

| # | Key | Signal | `n_min` | `e_min` | `b_min` | Notes |
|---|---|---|---|---|---|---|
| 1 | `sector_momentum` | Window deals/capital for a sector vs 8-wk mean | 3 deals | 1.5σ | 4 wk | Fires for the top 3–4 sectors weekly. Correct. |
| 2 | `stage_shift` | Capital share by stage vs baseline | 5 deals | 10 pp | 4 wk | Stages aggregate across sectors; clears easily |
| 3 | `cheque_inflation` | Median cheque per stage vs trailing median | 4 deals/stage | 25% | 6 wk | Fires for Seed/Series A; correctly silent for Series B+ |
| 4 | `investor_rotation` | Investor's first deal in sector X | **see 14.3** | — | 8 wk | **Most dangerous detector — read 14.3** |
| 5 | `thesis_clustering` | ≥3 deals in one embedding cluster | 3 deals | cohesion ≥ 0.75 | 2 wk | Cohesion = mean pairwise cosine. Without it you report "3 AI companies" as a thesis. |
| 6 | `syndicate_formation` | Investor pair co-investing repeatedly | **3** co-investments | lift ≥ 2.0 | 8 wk | Raised from 2. Indian VC co-invests constantly; 2 is near-random. Lift = observed / expected given each fund's deal count. |
| 7 | `followon_compression` | Median months between rounds falling | 4 round-pairs | 20% | 8 wk | Depends on `prior_round_*` extraction (Stage B). If pairs < 4, suppress and say so. |
| 8 | `capital_concentration` | Top-3 share of window capital vs baseline | — | 15 pp | 4 wk | Always computable |
| 9 | `geographic_shift` | City share vs baseline | 4 deals | 10 pp | 4 wk | Bengaluru clears weekly; others correctly quiet |
| 10 | `sector_silence` | Mandate sector at 0 deals for N weeks | — | N ≥ 3 wk | **6 wk** | Hard gate: without 6 weeks of history you would flag a sector "silent" when you simply were not collecting |
| 11 | `outlier_deal` | Deal >2σ from its stage×sector distribution | **n ≥ 8** in bucket | 2.0σ | 6 wk | Cannot compute σ from 4 points. Fallback: stage-only bucket. Still <8 → suppress. |
| 12 | `repeat_founder` | Multiple ex-operator founders from one company | 2 deals | — | 4 wk | **Will fire rarely** — founder extraction from headlines is unreliable. Accepted. Mark as `best_effort` on the methodology page so it does not look broken. |

### 14.3 Investor rotation — the mandatory guard

As naively written, this detector fires for every investor in a young database, because the lookback window *is* the entire history. It would report forty funds "entering new sectors" in week one.

```
fire_investor_rotation IF:
     investor.deal_count_in_db >= 3          -- genuinely active, not just new to us
 AND investor has 0 prior deals in sector X
 AND database_history_weeks >= 8
 AND investor.first_seen_at <= now() - 8 weeks
```

All four conditions required. Implement them as explicit guards with individual log lines so a suppressed fire is debuggable.

### 14.4 Pattern persistence

`patterns` has `UNIQUE(profile_id, iso_week, detector_key)`. On each run, check whether the same `detector_key` fired for the same subject last week; if so, increment `consecutive_weeks`. This enables "third consecutive week" phrasing and gives the product institutional memory — the thing that makes it an intelligence system rather than a report generator.

### 14.5 Negative patterns count

`sector_silence` is as important as `sector_momentum`. Absence of capital in a mandate sector is actionable. It must appear in the digest with the same prominence as positive patterns.

---

## 15. Alerts engine

Event-driven, entirely separate from the digest scheduler. Runs after every collection cycle.

### 15.1 Trigger taxonomy

| Severity | `trigger_key` | Condition | Delivery |
|---|---|---|---|
| 🔴 critical | `competitor_raise` | Adjacency `competitor` to a portfolio company | Immediate |
| 🔴 critical | `watchlist_raise` | Watchlist company raises | Immediate |
| 🟠 high | `same_layer_raise` | Adjacency `same_layer` | Immediate if `amount_usd > 5M`, else next digest |
| 🟠 high | `portfolio_mentioned` | A portfolio company appears in any deal or event | Immediate |
| 🟠 high | `competitor_acquired` | M&A event where target is adjacent to a portfolio company | Immediate |
| 🟡 medium | `adjacency_cluster` | §13.3 cluster threshold met | Immediate |
| 🟡 medium | `competitor_shutdown` | Shutdown event for an adjacent company | Next digest |
| 🟡 medium | `sector_momentum_flip` | A portfolio company's sector flips accelerating↔cooling | Next digest |
| 🔵 info | `supplier_raise` | Adjacency supplier/customer/complement | Next digest |
| 🔵 info | `tracked_investor_backs_competitor` | A watchlist investor backs a company adjacent to the portfolio | Next digest |

### 15.2 Hygiene rules — non-negotiable

Alert products get muted when these are missing.

1. **Dedupe key.** `dedupe_key = sha256(profile_id + trigger_key + portfolio_id + deal_id)`, with a UNIQUE constraint. One event never alerts twice, even when five publications report it across three days.
2. **Quiet hours.** Alerts generated inside `quiet_hours` are set to `status = 'queued'` and released at the window's end.
3. **Daily cap.** `max_immediate_per_day` (default 3). Overflow is set to `status = 'batched'` and folded into the next digest.
4. **Cooldown.** The same portfolio company cannot generate more than one immediate alert per 24h unless severity is `critical`.
5. **Per-trigger toggles.** `config.alerts.triggers_enabled` and a `severity_threshold` gate.
6. **Full log.** Every alert — sent, queued, suppressed, batched — is written to `alerts` with its reason. This powers an in-app alert inbox and prevents re-fires on cron retries.

### 15.3 Alert email

Subject does the work:

> `🔴 Competitor alert: {Company} raised {amount} {stage} — competes with {Portfolio Co}`

Body, in order: what happened · why it's flagged (the adjacency `rationale`) · the deal card with full provenance · what else moved in that space in the last 30 days · link to the portfolio company page.

---

## 16. Digest generation

### 16.1 Weekly template — section order

1. **Header** — window dates, profile name, generated-at timestamp
2. **Headline + KPI strip** — deals, total capital, median cheque, WoW delta, market temperature
3. **🔴 Watchlist hits** — only if non-empty; loud, at the top
4. **🔴 Portfolio adjacency alerts** — including any cluster trigger; the most important section in the product
5. **TL;DR** — 3–5 bullets, each containing a statistic
6. **Patterns this week** — fired detectors with statements, statistics, confidence labels, and clickable evidence chips. Includes negative patterns.
7. **Ranked deals** — tiered, each with score badge, expandable scorecard, and full provenance block
8. **Outside your mandate, worth knowing** — the serendipity section, with its explanatory line
9. **Sector heat** — table with WoW direction indicators, mandate sectors visually distinguished
10. **Stage & cheque** — distribution, median by stage, percentile context
11. **Investor activity** — leaderboard · active in your sectors · new entrants · cadence shifts · syndicates · follow-on vs new ratio
12. **New capital in the ecosystem** — fund closes, with overlap-to-mandate flags
13. **Exits & consolidation** — M&A, shutdowns, IPO filings
14. **Founders in motion** — `people_move` events with `move_type = 'founded'`, plus departures at adjacent companies
15. **LP talking points** — 3–5 forwardable bullets
16. **Open questions** — 2–3 things the data suggests but cannot confirm
17. **Footer** — link to dashboard, methodology, settings, share link

### 16.2 Daily template — section order

A daily email cannot say "this week's patterns" — there are none. It is a different document.

1. **Header** — date, profile
2. **Headline + compact KPI line** — today's deals, capital, 7-day rolling context
3. **🔴 Alerts** — watchlist + adjacency, if any
4. **Today's deals** — ranked, compact cards, provenance preserved
5. **Rolling 7-day context** — one short paragraph with the trailing numbers, no pattern claims
6. **Events** — M&A, fund closes, people moves, if any
7. **Footer**

**No Patterns section. No LP talking points. No serendipity section** (it needs a wider window to be meaningful).

If `deal_count < config.delivery.min_deals_to_send`, skip the send entirely and log the skip. Do not send an empty email.

### 16.3 Both templates

- Mobile-first. Aarav reads on a phone before opening his laptop. Single column, large tap targets, no horizontal scroll.
- Every company name links to its primary source.
- Every number is traceable.
- Graceful degradation: a failed source degrades a section, never breaks the email.
- Preview routes: `/api/digest/preview?mode=weekly&profile=...` and `...&mode=daily` render the template without sending. Required for development and for the demo.

---

## 17. Email delivery

- **Resend** with React Email templates.
- `digests.email_sent_at` and `email_status` written on completion.
- **`profiles.last_digest_sent_at` is updated only on successful send.** A failed send must not advance the window, or deals are lost.
- Retry with backoff; after 3 failures, mark `email_status = 'failed'`, log, and leave the digest viewable on the web.
- UTM parameters on outbound links so click data is attributable (optional display on the health page).
- Plain-text alternative generated for every HTML email.

---

## 18. Web application

Visual design is deliberately deferred — build with a clean, neutral Tailwind system and correct information hierarchy. A dedicated UI/UX polish pass happens at the end (§24, M9).

### 18.1 `/` — This Period

**KPI row (7 tiles, each with WoW delta and sparkline):**
Deals · Total capital · Median cheque · Watchlist hits · Adjacency alerts · Active investors · Market temperature

**Charts:**

| Chart | Form | Why |
|---|---|---|
| Capital + deal count, 12 weeks | Bars (capital) + line (count), dual axis | The most-read chart in the product |
| Sector heat | Horizontal bars ordered by capital, WoW direction indicator per row, mandate sectors distinguished | Primary "where is capital moving" read |
| Stage mix over time | Stacked area, 8 weeks | Shows capital migrating early/late |
| Deal-size distribution | Histogram with median marked | Makes outliers obvious at a glance |
| Geography | Horizontal bar by city | A bar chart beats a map here — it is readable and ranked |
| Capital concentration | Single stat + 12-week line | Reveals when one mega-round distorts every average |

**Tables:** ranked deals (score, tier, provenance, expandable scorecard) · watchlist hits · adjacency alerts · investor leaderboard

**Controls:** profile switcher · window selector · **Regenerate** button (essential for demo — no one waits until Monday)

### 18.2 `/trends`

Any metric over any window. Sector × week heatmap grid. Stage velocity (median months between rounds by sector). Mandate sectors vs ecosystem baseline. Silence tracker (weeks since last deal per mandate sector). Pattern history timeline with `consecutive_weeks`.

### 18.3 `/investors`

Leaderboard · investor profile pages (all their deals, sector concentration, stage distribution, median cheque, cadence over time, top co-investors, portfolio overlap with yours, first-seen date) · new-entrant log · co-investment graph.

**Warm-path finder:** given a target company, traverse the co-investment graph from its lead investor to any investor on the watchlist, and render the path. Pure graph math over existing data, no new sources. This is the highest-impact feature on the dashboard — build it.

### 18.4 `/portfolio`

Each portfolio company with: adjacency timeline, competitive-pressure score (count and recency of competitor/same-layer edges), sector momentum for its sector, related events. Each watchlist entry with status, last event, notes.

### 18.5 `/explorer`

Full searchable, filterable deal and event archive. Filters: sector, stage, investor, city, date range, amount range, tier, verified-only, event type. Table and card views. Sort by date, amount, score. CSV export of the current filtered view.

**Natural-language search:** a query box where Gemini translates the question into **parameterised filters against a whitelisted field set** — never raw SQL from the model. Output schema is a constrained filter object which the server validates with Zod before querying.

### 18.6 `/sectors/[sector]`

Sector page: trend over time, all deals, active investors, cheque evolution, **market map** (clusters from `market_map_clusters`, with portfolio companies highlighted in place), exits in the sector.

**Generate deep-dive** button: produces, in ~20 seconds, a long-form analysis — all deals in the window, sub-sector breakdown with the market map, active investors and cheque patterns, cheque-size evolution, notable exits, portfolio exposure, and a Gemini-written 4–6 paragraph analysis grounded in those aggregates with cited deals. Rendered on-page and exportable to PDF.

Market map clusters are **pre-computed nightly** (k-means or HDBSCAN over company embeddings per sector, Gemini labels each cluster). Never cluster on page load — it will time out.

### 18.7 `/methodology` — the rubric page

Required. Contents:

1. **Weights table**, rendered live from the active profile's config
2. **Worked example** — one actual deal from the current window with its full breakdown
3. **Override rules** — each with a plain-English sentence
4. **Tier legend**
5. **The Serendipity Rule**, stated in the verbatim sentence from §11.4
6. **Pattern detector table** — current `n_min` / `e_min` / `b_min` per detector, and which are **currently active vs suppressed for insufficient history**, with the reason
7. **Data provenance** — sources polled, backfill vs live split, dedupe method, confidence definitions
8. **Assumptions** — including the simulated-portfolio disclosure from §8.2, verbatim

### 18.8 `/settings`

Full mandate editor: sectors (core/watch/excluded), stages, cheque range, geographies, exclusion keywords, delivery schedule and recipients, alert triggers and thresholds, **Tune weights** panel.

Watchlist management: add/remove/edit for all four watch types, bulk paste (one per line), alias management (Gemini suggests aliases on add, user confirms), per-entry notes and tags, per-entry alert toggle, status column, **CSV import and export**, and a "Suggested to watch" panel (companies appearing in high-scoring deals that are not yet watched).

Portfolio management: add/remove/edit companies, with description and `adjacency_keywords` fields and inline guidance that keywords must be specific.

### 18.9 `/health`

Sources polled with per-source success rate and last error · articles → candidate records → unique deals funnel with the dedupe reduction · Gemini calls and token usage per run · backfill vs live record split · last run and next scheduled run · detector status (active/suppressed with reason) · run log tail.

This page is how an evaluator confirms the system is genuinely live. Make it honest and complete.

### 18.10 `/share/[token]`

Public read-only render of a digest. No auth. Forwardable to LPs. Token generated per digest.

---

## 19. Backfill — 12 weeks

**Run this in the first week of the build, not the week of submission.** It is the single highest return-per-hour task in the project.

### 19.1 Why 12 and not 3

Three weeks produces deals but no baselines. Every one of these renders blank or wrong: "vs 8-week average", sector momentum, investor new-entrant detection (which would produce ~40 false positives), cheque percentiles, round velocity, pattern persistence. The intelligence layer — the actual differentiator — would be empty on the day an evaluator opens the site.

### 19.2 The weekly-roundup strategy

**Do not backfill from daily feeds** — RSS exposes only the most recent 10–50 items.

Several Indian startup publications publish a **weekly funding roundup** containing the full week's deal list with amounts and lead investors, plus city breakdown, series breakdown, M&A, hirings/departures, and financial results — all in a single article. One such article yields roughly 20–30 structured deals.

Twelve fetches ≈ twelve weeks ≈ 250–300 deals. These roundups also contain the M&A, people-moves and financial-result data needed for the event types in §7.3, so backfill and event seeding happen in one pass.

### 19.3 Procedure — `src/scripts/backfill.ts`

| Step | Action |
|---|---|
| 1 | Discover the last 12 weekly roundup URLs from each publication's report archive (paginated listing pages) |
| 2 | Fetch and store each as a `raw_articles` row with `source_type` noted |
| 3 | Run a **roundup-specific extraction prompt** — one Gemini call per roundup, extracting an array of deals plus an array of events. Different prompt from the single-article extractor. |
| 4 | Cross-check: for the 3 most recent weeks, compare roundup-extracted deals against live RSS-collected deals. Measure overlap. Log the result — it is your extraction-quality evidence. |
| 5 | Normalize → dedupe → enrich as usual |
| 6 | Tag every row `ingestion_mode = 'backfill'`, `backfill_source = 'weekly_roundup'` |
| 7 | Score against all three profiles |
| 8 | Run the full detector suite against the most recent week to verify baselines compute and detectors fire |

### 19.4 Honesty requirement

The health page must distinguish backfilled from live records. Do not present backfill as continuous live collection. The correct claim — and it is a strong one — is: *twelve weeks of backfilled history plus N days of genuine continuous live operation.*

---

## 20. Seed data

Shipped in `seed/`, loaded by an idempotent `pnpm seed` script.

| File | Contents |
|---|---|
| `sources.json` | The full source registry from §9.1 |
| `sector-taxonomy.json` | The ~20 canonical sectors with sub-sector hints |
| `profile-aarav.json` | §8.1, complete |
| `profile-fintech-seed-fund.json` | Fintech-only, Seed-only, Mumbai-weighted, $500K–2M, 3 portfolio cos, 8 watchlist |
| `profile-consumer-syndicate.json` | D2C + quick commerce, Angel/Pre-seed, sub-$500K, 3 portfolio cos, 8 watchlist |
| `investor-aliases.json` | Known Indian VC name variants for canonicalisation |
| `stage-mappings.json` | ~40 raw stage phrasings → canonical enum |
| `city-mappings.json` | City variants → canonical city |

**No fake deals. No fake articles. Seed data is configuration only.**

---

## 21. Scheduling

### 21.1 One cron, profile-aware dispatch

Assume exactly one cron entry is available.

```jsonc
// vercel.json
{ "crons": [ { "path": "/api/cron/dispatch", "schedule": "30 0 * * *" } ] }
//  00:30 UTC = 06:00 IST
```

`/api/cron/dispatch` does:

1. Verify `CRON_SECRET` header. Reject otherwise.
2. Create a `run_id`.
3. Kick the collection chain (each stage endpoint invokes the next, chunked, each well under the function time limit).
4. After collection completes, run the alerts engine.
5. Iterate every profile. For each, evaluate: does today, in the profile's timezone, match its `delivery.days`? If yes and `last_digest_sent_at` is older than the cadence, generate and send.
6. Release queued alerts whose quiet-hours window has ended.
7. Nightly: recompute market map clusters, investor denormalised counts, FX rate.

One cron, unlimited schedules. **State this in the Components Map** — it is a good design answer to a real platform constraint.

### 21.2 Manual triggers

Protected endpoints for `collect`, `rescore`, `generate-digest`, `send-digest`, `backfill`, `recompute-clusters`. The **Regenerate** button in the UI calls `rescore` + `generate-digest`. Essential for demonstration.

### 21.3 Chunking

Every stage endpoint accepts `?cursor=` and `?limit=` and returns `{ processed, next_cursor }`. The dispatcher loops until `next_cursor` is null or a time budget is hit, then schedules continuation. No invocation ever approaches the function timeout.

---

## 22. API surface

All read endpoints are public (no auth in v1). All mutating and cron endpoints require a secret header.

```
GET  /api/deals?profile=&from=&to=&sector=&stage=&investor=&city=&min_amount=&tier=&limit=&cursor=
GET  /api/deals/:id
GET  /api/events?type=&from=&to=
GET  /api/digest/latest?profile=&mode=
GET  /api/digest/:id
GET  /api/digest/preview?profile=&mode=          # renders, does not send
GET  /api/aggregates?profile=&from=&to=
GET  /api/patterns?profile=&week=
GET  /api/investors/:id
GET  /api/sectors/:sector
GET  /api/health
GET  /api/export/deals.csv?<same filters as /api/deals>

POST /api/profile/:id/config                     # secret required
POST /api/watchlist                              # secret required
DELETE /api/watchlist/:id                        # secret required
POST /api/portfolio                              # secret required
POST /api/manual-deal                            # secret required
POST /api/cron/*                                 # CRON_SECRET required
```

---

## 23. Exports

| Export | Contents |
|---|---|
| **Deals CSV** | All deal fields + `relevance_score`, `tier`, `reason`, `primary_source_url`, `all_source_urls` (pipe-delimited), `corroboration_count`, `is_verified`, `ingestion_mode` |
| **Watchlist CSV** | Round-trip compatible with the CSV importer |
| **Digest PDF** | Print-friendly render of any digest |
| **Deep-dive PDF** | The sector deep-dive |
| **JSON API** | §22 |

The CSV export matters more than it looks: Aarav is replacing a spreadsheet. Let him bring his spreadsheet in and take one out. It removes the single biggest adoption objection and costs an hour.

---

## 24. Build order and milestones

Do not advance until acceptance criteria pass.

### M0 — Foundation
Next.js + TypeScript strict + Tailwind · Neon connected via `@neondatabase/serverless` · **pgvector extension enabled** · Drizzle schema and first migration · Zod-validated env config · logger with `run_id` threading · `CLAUDE.md`, `README.md`, `DECISIONS.md` · deployed to Vercel with a placeholder page.
**Accept:** deployed URL responds; `SELECT 1` and a `vector` round-trip both succeed from a route handler.

### M1 — Ingestion
Source registry seeded · RSS and HTML parsers · URL-hash identity · FX rate fetcher · `raw_articles` populating from all Tier 1 sources · health page v0 showing per-source status.
**Accept:** ≥ 200 real articles in `raw_articles` from ≥ 6 sources; health page shows per-source success rates; re-running the collector creates zero duplicates.

### M2 — Extraction + normalization
Gemini wrapper (`src/lib/gemini.ts`: schema enforcement, retry, token logging) · filter prompt · deal and event extraction prompts · Zod validation · quarantine · normalization (currency, stage, names, dates, cities) · deterministic deal IDs.
**Accept:** ≥ 60 structured deals extracted from real articles; zero unvalidated writes; quarantine populated for genuine failures; manual spot-check of 10 deals against their source articles shows correct company, amount and stage.

### M3 — Dedupe + enrich
Four-layer dedupe · embeddings · company and investor linking · alias canonicalisation · prior-round history capture.
**Accept:** dedupe funnel visible on the health page with a real reduction; a deal reported by ≥ 3 publications exists as one row with 3 `deal_sources`; investor name variants resolve to one row.

### M4 — Backfill
Roundup discovery · roundup extraction prompt · 12-week backfill executed · cross-check against live data for the recent 3 weeks.
**Accept:** ≥ 150 unique deals spanning ≥ 12 weeks; `ingestion_mode` split visible on the health page; cross-check overlap logged.

### M5 — Scoring + adjacency
Profiles seeded (all three) · relevance rubric fully implemented with stored breakdowns · serendipity override · vector shortlist + Gemini adjudication for adjacency · `/methodology` page live.
**Accept:** every deal has a score for every profile with a complete breakdown; ≥ 1 adjacency edge detected with a rationale; the three profiles produce materially different top-10 lists from the same window; methodology page renders from live config.

### M6 — Aggregates + patterns
All aggregate queries · 12 detectors with three-gate enforcement · the §14.3 investor-rotation guard · pattern persistence · suppression reporting.
**Accept:** ≥ 2 patterns fire with cited evidence; ≥ 1 detector is correctly suppressed with a stated reason; every aggregate returns its `n`; no detector fires below its gates (verify by temporarily lowering data and observing suppression).

### M7 — Digest + email
Narration prompt with evidence enforcement · weekly template · daily template · preview routes · Resend integration · `last_digest_sent_at` semantics · share tokens.
**Accept:** both templates render in preview; a real digest email is delivered and readable on a phone; a narrative paragraph with no evidence IDs is rejected rather than rendered; `last_digest_sent_at` advances only on success.

### M8 — Web application
All screens from §18 · explorer with filters and NL search · investor pages and warm-path finder · market maps · deep-dive generator · settings with full CRUD · exports.
**Accept:** every success criterion S1–S12 in §3.3 passes.

### M9 — Alerts, hardening, polish
Alerts engine with all hygiene rules · graceful degradation everywhere · last-good-digest fallback · **UI/UX design pass** (visual system, charts, dark mode, responsive) · README with assumptions and limitations · Components Map.
**Accept:** killing a source mid-run degrades rather than breaks; an alert fires once and only once for a repeated-report event; the adjacency-cluster trigger demonstrably fires.

---

## 25. Testing and verification

- **Unit:** normalization (currency, stage, names, dates), scoring math, detector gates, dedupe layers 1–3, window computation
- **Golden-file:** 20 real articles with hand-checked expected extractions, run on every prompt change. This is how you catch prompt regressions.
- **Integration:** full pipeline on a fixed set of stored `raw_articles`, asserting final deal count and dedupe reduction
- **Idempotency:** run every stage twice; assert no duplicate rows and no changed counts
- **Window test:** simulate consecutive Monday and Thursday sends; assert zero deal overlap between digests
- **Suppression test:** reduce history below `b_min`; assert the detector suppresses and the methodology page says so
- **Degradation test:** disable a source mid-run; assert the digest still generates
- **Visual check:** render both email templates at 375px width

---

## 26. Environment variables

```
DATABASE_URL=                 # Neon pooled connection string
GEMINI_API_KEY=
GEMINI_MODEL=                 # verify current flash model id
GEMINI_EMBEDDING_MODEL=       # verify current embedding model id
RESEND_API_KEY=
EMAIL_FROM=
CRON_SECRET=
ADMIN_SECRET=                 # mutating endpoints
NEWS_API_KEY=                 # if a news API is used
FX_API_URL=
NEXT_PUBLIC_APP_URL=
```

`.env.example` is committed with every key present and no values. `.env` is gitignored. No secret ever appears in logs.

---

## 27. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Source goes down during evaluation | Brief looks broken | Per-source isolation; last-good digest always servable; health page states which source failed |
| Vercel function timeout | Pipeline fails silently | Chunked stages with cursors; strict time budget per invocation; dispatcher continuation |
| Gemini quota exhausted | No extraction | Cheap filter pass before extraction; batching; per-article caching; token logging with a visible budget |
| Dedupe under-performs | "47 deals" is really 12 | Four layers including vector + LLM adjudication; funnel visible on health page; manual spot-check in M3 |
| Detectors fire on noise | Fabricated trends | Three-gate rule; the §14.3 investor guard; evidence enforcement in narration |
| Narration hallucinates | Untrustworthy product | Aggregates-only input; mandatory evidence IDs; code-level rejection of unsupported claims |
| Round-pair data too sparse | Detector 7 never fires | Prior-round extraction in Stage B; suppression with a stated reason as fallback |
| Backfill extraction is inaccurate | Bad history poisons baselines | M4 cross-check against live-collected data for overlapping weeks; log the overlap figure |
| Neon free-tier limits hit | Database unavailable | `raw_articles.body_text` retention pruning; monitor storage |

---

## 28. Glossary

| Term | Meaning |
|---|---|
| **Window** | The period a digest covers: `last_digest_sent_at` → now |
| **Baseline** | Trailing 8 weeks, fixed regardless of cadence |
| **Adjacency** | A detected competitive or value-chain relationship between a new deal's company and a portfolio company |
| **Serendipity Override** | The rule that forces high-significance out-of-mandate deals into the digest |
| **Three-gate rule** | Sample size + effect size + baseline history, all required for a detector to fire |
| **Corroboration** | Number of distinct publications reporting the same deal |
| **Provenance block** | The source list, publication names, timestamps and confidence badges attached to every deal |
| **Profile** | One fund's mandate configuration |
| **Roundup** | A publication's weekly article listing an entire week's deals — the backfill unit |

---

## 29. The three sentences

Judge every implementation decision against these:

1. **Would this have caught the two adjacent deals before the board meeting?**
2. **Does this work for a fund that isn't Aarav?**
3. **Can he trust this number enough to repeat it to an LP?**

If a feature does not serve one of these, it is not in v1.
