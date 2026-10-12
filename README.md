# Startup Funding Pulse

A weekly intelligence digest of Indian startup funding activity for an early-stage
venture scout. It turns scattered funding announcements into a ranked, deduplicated,
provenance-carrying brief, with statistically gated patterns and alerts when
companies adjacent to a tracked portfolio company raise money.

Built for MESA Cohort C4, *AI and its Applications*, Final Examination, Problem
Statement 14. The full specification is [`docs/PRD.md`](docs/PRD.md), and the
engineering rules are in [`CLAUDE.md`](CLAUDE.md).

> **Status: M0–M7 complete.** Live collection runs daily; 13 weeks of history were backfilled
> from weekly roundups. See [Build status](#build-status) and the live [/health](https://startup-funding-pulse.vercel.app/health) page.

---

## Simulated portfolio

> **Simulated portfolio.** Aarav is a fictional persona from the assigned problem statement. The companies listed as portfolio holdings are real Indian startups, used so that competitive-adjacency detection can be verified against companies a reader recognises. **No investment, advisory or commercial relationship between this project, the persona and these companies is implied or asserted.** Watchlist entries are companies and funds being monitored, which likewise implies no relationship.

---

## Architecture

```
sources → raw_articles → A filter → B extract → C normalize → D dedupe → E enrich
        → F score (per profile) → G aggregate (SQL only) → H detect (3-gate)
        → I narrate (Gemini reads aggregates, never raw lists) → J deliver
```

- **Statistics are computed in SQL. The LLM interprets numbers; it never discovers them.**
  Gemini classifies, extracts, adjudicates and narrates, and does nothing else.
- Every pipeline stage is idempotent, chunked (`?cursor=&limit=`) and logged to `run_logs`.
  Failures go to `quarantine` and never crash a run.
- A single daily Vercel cron dispatches all profiles' schedules.

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), TypeScript strict |
| Hosting | Vercel |
| Database | Neon Postgres + pgvector, via `@neondatabase/serverless` (HTTP) |
| ORM | Drizzle |
| AI | Google Gemini Flash + Gemini embeddings via `@google/genai` (see DECISIONS D-002) |
| Email | Resend + React Email |
| Validation | Zod at every boundary |

The full component map, with the data flow diagram, the file for every PRD component and how
each one degrades, is in [`docs/COMPONENTS.md`](docs/COMPONENTS.md).

### Repository layout

```
docs/PRD.md               specification
drizzle/                  SQL migrations
prompts/                  every Gemini prompt, versioned (extract, adjudicate, narrate, nl-filter, deep-dive, …)
src/app/                  pages (/, /trends, /investors, /portfolio, /explorer, /sectors, /digests,
                          /methodology, /settings, /health, /share/[token]) and API routes (PRD §22)
src/components/           shared UI: charts (Recharts), deal lists, KPI tiles, settings editors
src/db/schema.ts          full data model (PRD §7)
src/db/queries/           named SQL query functions, one file per family
src/pipeline/             one module per stage (collect → … → deliver → mapclusters), digest, deep-dive, NL search
src/lib/                  env, logger, auth, Gemini wrapper, filters, formatting
src/scripts/              migrate, seed, pipeline, backfill, rescore, detect, mapclusters
tests/                    Vitest suites
```

---

## Setup

Requirements: Node ≥ 22, a Neon project, and a Vercel account.

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL at minimum
npm run db:migrate            # enables pgvector, creates all tables
npm run dev                   # http://localhost:3000
```

Check the database connection:

```bash
curl -s http://localhost:3000/api/health/db
```

`ok: true` means `SELECT 1` succeeded and a vector survived a round trip through
pgvector, with the database's cosine distance matching the value computed locally.

| Script | Purpose |
|---|---|
| `npm run typecheck` | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`) |
| `npm test` | Vitest unit tests |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |

### Deploying

1. Push the repository to GitHub and import it in Vercel.
2. Set `DATABASE_URL` (and any later keys) in Vercel → Project → Environment Variables.
3. Run `npm run db:migrate` once against the Neon database, from a local machine with `.env` set.
4. Visit `https://<deployment>/api/health/db`.

---

## Using the web app

| Screen | What it shows |
|---|---|
| `/` This period | 7 KPI tiles (change vs previous window, 12-week sparklines), capital + count chart, sector heat, stage mix, deal-size histogram, geography, concentration, investor leaderboard, watchlist hits, adjacency alerts, ranked deals with expandable scorecards. Profile switcher, window selector, **Regenerate brief**. |
| `/trends` | Any metric (count, capital, median) over 8/12/26 weeks: sector × week heatmap, mandate vs ecosystem, silence tracker, stage velocity, pattern history with streaks. |
| `/investors` | **Warm-path finder**, leaderboard, new-entrant log, co-investment graph; `/investors/[id]` profile pages. |
| `/alerts` | The alert inbox: every alert (sent, queued, batched, digested, suppressed) with the hygiene rule that decided it. |
| `/portfolio` | Non-dismissible simulated-portfolio disclosure, per tracked company: adjacency timeline, competitive pressure, sector momentum, related events; watchlist status. |
| `/explorer` | Every deal and event; filters, table/card views, CSV of the current view, **natural-language search** (Gemini → validated filter object, never SQL). |
| `/sectors/[sector]` | Trend, deals, investors, cheque evolution, nightly **market map** with tracked companies placed, exits, on-demand **deep-dive** (PDF via print). |
| `/brief` | **The brief, as a dashboard**: the latest brief for the selected profile (or any from its history), with KPI masthead, summary, alerts and adjacency maps, the written analysis with source chips, pattern cards, ranked deals, market charts and LP talking points. **Live preview** builds a fresh one without saving; **Regenerate brief** saves a new one. Public share links (`/share/[token]`) render the same page read-only. |
| `/settings` | Mandate editor with **Tune weights**, watchlist (alias suggestions, bulk paste, CSV import/export, suggestions), tracked companies with keyword guidance, manual article submission. |

Reading is public. Saving anything (settings, Regenerate) asks once for `ADMIN_SECRET` and keeps
it in the tab's session storage only (D-064). Demo of S5: change a core sector in `/settings`,
save, then **Regenerate brief** on `/` — the ranking reorders (verified: making Fintech the only
core sector for the consumer syndicate moved two Fintech deals into its top six; restoring
reverted it exactly).

## Alerts

The alerts engine (PRD §15) runs after scoring in every pipeline cycle and again from a second
cron at 07:30 IST, after the default quiet hours. Ten triggers (competitor, watchlist, same-layer,
tracked-company mention, adjacent acquisition or shutdown, adjacency cluster, sector momentum flip,
supplier/customer, watchlist investor backing an adjacent company) pass through the hygiene rules:

- **One alert per event:** a UNIQUE `sha256(profile|trigger|portfolio|deal)` key. Re-running the
  engine on the same data creates zero rows (verified on live data).
- **Quiet hours queue, the daily cap and the 24 h cooldown batch.** Batched alerts appear in the
  next digest under "Alerts held for this brief".
- **Severity below the profile's threshold is held for the digest, never dropped** (D-072).
  Switching a trigger off suppresses it.

Immediate alerts are emailed with a subject that says what happened (`🔴 Competitor alert: Kinetic
Age raised $250K (stage undisclosed) — competes with Even Healthcare`). The body gives the
adjacency rationale, the deal card with sources, and the last 30 days around that tracked company.

## Testing

| Command | What it checks |
|---|---|
| `npm test` | 196 unit and integration tests: normalisation, scoring, detector gates, dedupe and merge, alerts hygiene, degradation, plus an integration snapshot of 58 real source reports merging into 25 stored deals |
| `npm run golden` | Re-extracts 20 real articles with the current prompt and scores company, stage, amount and leads against corroborated values; run on every prompt change (latest: 95 / 95 / 95 / 90%) |
| `npm run verify:idempotency` | Runs every processing stage twice on live data; fails if any of 16 tables or the deal/score fingerprints change on the second pass |

## Assumptions

- Aarav's sectors, stages, cheque size, portfolio and watchlist are not in the problem
  statement. They are **assumed**, seeded as defaults, and fully editable (PRD §4.2, §8).
- The portfolio uses real companies as simulated holdings. See the disclosure above.

## Limitations

- History before live operation began (11 Oct 2026) comes from weekly roundups (Inc42, Entrackr),
  not continuous collection; `/health` shows the backfill/live split. Roundups list fewer
  details per deal than full articles (often no city or founders).
- Live RSS alone caught 15% of the deals the weekly roundups list over the same 3 weeks
  (cross-check, D-042); breadth comes from roundups plus the optional GNews key.
- Stage is left `Undisclosed` when an article does not name the round (~40% of deals).
- The newest week is covered by live collection *and* roundups while baseline weeks are
  roundup-only, so this week's counts (and sector momentum) read higher than a like-for-like
  comparison would until live history fills the baseline.
- Geographic-shift and follow-on-compression detectors are suppressed today for lack of
  city-reported and earlier round-pair history; they say so on `/methodology`.
- Email uses Resend's shared test sender, which only delivers to the Resend account owner;
  `DIGEST_TO` routes every profile's digest there until a sending domain is verified.
- Vercel Hobby cron can fire up to 59 minutes late, so the 06:30 IST brief lands 06:30–07:29.
- VCCircle's 20 s Crawl-delay limits article-page fetches, so its deals are extracted from
  headlines and leads, dated by first sighting (D-036).
- Regenerate after a mandate change takes up to ~90 s (new sector-fit calls at the free-tier
  rate limit, then narration); with cached fits it takes ~45 s. The sector deep-dive takes 20–60 s.
- Investor names are canonicalised through an alias table plus normalised-name matching
  (D-076); a genuinely new spelling of a known fund can still create a second investor until
  it is added to `seed/investor-aliases.json` and `npm run merge-investors` is run.
- Market-map totals are all-time per cluster; sectors with fewer than 6 embedded companies have
  no map yet.
- Alert emails, like digests, go to `DIGEST_TO` while the Resend test sender is in use.
- Queued alerts are released once a day (07:30–08:29 IST), not the minute quiet hours end,
  because Vercel Hobby crons run daily (D-071).
- Alerts consider deals and events from the last 7 days; older history never alerts.

## Build status

| Milestone | State |
|---|---|
| M0 Foundation | Done, verified in production |
| M1 Ingestion | Done: 10 live Tier 1 sources, idempotent collection, verified in production |
| M2 Extraction | Done: 9/10 spot-check correct; 0 unvalidated writes |
| M3 Dedupe + enrich | Done: multi-outlet deals merge to one row; investor variants resolve |
| M4 Backfill | Done: 293 unique deals over 14 ISO weeks (249 backfill, 44 live); cross-check logged |
| M5 Scoring + adjacency | Done: 882 scorecards (294 deals × 3 profiles), 45 adjacency edges with rationales, distinct top-10s per profile; live `/methodology` |
| M6 Aggregates + patterns | Done: 12 three-gate detectors (5 fired, 5 quiet, 2 suppressed with reasons for W41); zero fires below gates under restricted history; Aggregates object with `n` everywhere |
| M7 Digest + email | Done: weekly + daily React Email templates (375 px verified), evidence-enforced narration, preview routes, share links; real digest delivered via Resend; window advances only on success |
| M8 Web application | Done: all PRD §18 screens and §22 endpoints; S5 verified end to end (mandate change → Regenerate → reorder); NL search, warm-path finder, nightly market maps, deep-dive, CSV in/out |
| M9 Alerts, hardening, polish | Done: alerts engine with all six hygiene rules (fires once per event — second run created 0 rows; cluster trigger fired for Even Healthcare and Snitch), per-source/stage/profile isolation with a degradation test, `/brief/latest` fallback, theme toggle and light/dark pass, Components Map |

Implementation decisions are logged in [`DECISIONS.md`](DECISIONS.md).
