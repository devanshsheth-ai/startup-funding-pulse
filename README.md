# Startup Funding Pulse

A weekly intelligence digest of Indian startup funding activity for an early-stage
venture scout. It turns scattered funding announcements into a ranked, deduplicated,
provenance-carrying brief, with statistically gated patterns and alerts when
companies adjacent to a tracked portfolio company raise money.

Built for MESA Cohort C4, *AI and its Applications*, Final Examination, Problem
Statement 14. The full specification is [`docs/PRD.md`](docs/PRD.md), and the
engineering rules are in [`CLAUDE.md`](CLAUDE.md).

> **Status: M0–M4 complete.** Live collection runs daily; 13 weeks of history were backfilled
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

### Repository layout (so far)

```
docs/PRD.md               specification
drizzle/                  SQL migrations (0000 enables pgvector, 0001 creates schema)
src/app/api/health/db     M0 infrastructure probe
src/db/schema.ts          full data model (PRD §7)
src/db/client.ts          Neon HTTP + Drizzle client
src/db/queries/           named query functions, one file per family
src/lib/env.ts            Zod-validated environment
src/lib/logger.ts         structured JSON logs with run_id + secret redaction
src/scripts/migrate.ts    migration runner
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
- VCCircle's 20 s Crawl-delay limits article-page fetches, so its deals are extracted from
  headlines and leads, dated by first sighting (D-036).
- Vercel Hobby cron fires once a day with up to ±59 minutes of jitter, so the "06:30 IST"
  delivery time is approximate.

## Build status

| Milestone | State |
|---|---|
| M0 Foundation | Done, verified in production |
| M1 Ingestion | Done: 10 live Tier 1 sources, idempotent collection, verified in production |
| M2 Extraction | Done: 9/10 spot-check correct; 0 unvalidated writes |
| M3 Dedupe + enrich | Done: multi-outlet deals merge to one row; investor variants resolve |
| M4 Backfill | Done: 293 unique deals over 14 ISO weeks (249 backfill, 44 live); cross-check logged |
| M5–M9 | Not started |

Implementation decisions are logged in [`DECISIONS.md`](DECISIONS.md).
