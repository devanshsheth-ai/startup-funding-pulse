# CLAUDE.md — Engineering rules for Startup Funding Pulse

**Read `docs/PRD.md` before writing any code. This file is the short list of non-negotiables. The PRD is the specification.**

---

## 0. Hard constraints — violating any of these invalidates the project

1. **Gemini Flash only.** All AI tasks use Google Gemini. **Never import, call, or depend on the Anthropic/Claude API anywhere in application code.** No `@anthropic-ai/*` package. No Anthropic API key. This is an examination requirement.
2. **Live real data only.** Never create mock deals, placeholder funding rounds, fake companies in the `deals` table, or seeded sample articles. Every record must trace to a real fetched source. Seed data is configuration only (profiles, sources, taxonomy, mappings).
3. **Must deploy and run on Vercel** with a working public URL.
4. **Database is Neon Postgres with pgvector enabled.** Use `@neondatabase/serverless` (HTTP driver), never node-postgres TCP — serverless functions exhaust TCP pools.
5. **The portfolio uses real companies as *simulated* holdings.** Aarav is a fictional persona. The required disclosure (PRD §8.2) must appear verbatim in the README, on `/methodology`, and as a non-dismissible banner on `/portfolio`. `stage_held` is labelled "Assumed stage held" everywhere — never "Invested at" or "Our stake". **No generated narrative, alert or talking point may say the fund owns, invested in, or holds a stake in these companies** — state this constraint inside the narration and alert prompt files and require "tracked company" phrasing.

---

## 1. The central architectural rule

> **Statistics are computed in SQL. The LLM interprets numbers; it never discovers them.**

Gemini has exactly four jobs:

| Job | Input | Output |
|---|---|---|
| Classify | headline + lead | is this a relevant event, and which type |
| Extract | article text | structured record against a strict JSON schema |
| Adjudicate | two records, or a deal + a portfolio company | boolean + relationship + confidence |
| Narrate | **aggregate tables + fired patterns** | prose with mandatory cited evidence |

**Never** ask Gemini to "find patterns", "summarise the week", or "tell me what's interesting" from a raw list of deals. It produces confident fabrications. This is a build failure, not a style preference.

---

## 2. Data hygiene

- Every row carries `created_at`, `updated_at`, `run_id` where applicable.
- Every displayed number carries provenance. **Nothing renders unsourced.**
- `ingestion_mode` (`live` | `backfill` | `manual`) on every deal and event, surfaced honestly on `/health`.
- **Idempotent writes.** Every stage is safe to re-run. Deterministic IDs: `deal.id = sha256(normalized_name|round_stage|iso_week)`.
- **Article identity is `sha256(normalized_url)`** — never feed `guid`. Some feeds emit a constant or malformed guid for every item; keying on it silently drops them all.
- Raw article text is retained before extraction so prompt improvements can be replayed without re-crawling. Pruned 30 days after processing.
- **Failed extractions go to the `quarantine` table** with the error and payload. Never silently dropped, never crash the run.
- **Soft deletes only.** Nothing destructive.
- Units explicit everywhere: `amount_usd`, `amount_inr`, plus `fx_rate_used` and `fx_rate_date`.
- Every aggregate query returns its sample size `n`.

---

## 3. Code hygiene

- TypeScript strict. `noUncheckedIndexedAccess: true`. **No `any`.**
- **Zod at every boundary** — Gemini output, API input, env vars, external fetches. Parse, don't assume.
- One module per pipeline stage. Pure functions where possible. No stage reaching into another's internals.
- All config from env, validated at startup. Nothing hardcoded. `.env.example` committed with every key, no values. `.env` gitignored.
- **Every Gemini prompt lives in `/prompts` as a versioned file** (`extract-deal.v1.md`), never inline in business logic — so prompt changes can be diffed and rolled back.
- Named exports only. No default exports.
- One `src/lib/gemini.ts` wrapper handles schema enforcement, retry, backoff, and token logging. **No other file calls the Gemini SDK directly.**

---

## 4. Prompt hygiene

- `responseMimeType: "application/json"` with a `responseSchema` on **every** call.
- `temperature`: ≤ 0.2 for extraction and classification, ≤ 0.4 for narration.
- Every field nullable, with the instruction stated explicitly: **"Return null if the article does not state this. Do not infer, estimate, or guess."**
- Enum fields (sector, stage) must be constrained to the supplied taxonomy, verbatim. Reject free-text values at validation.
- Narration output carries `evidence_deal_ids[]` / `evidence_event_ids[]`. **A paragraph with no evidence is rejected in code before rendering.** Enforced, not requested.
- Token usage logged per call into `run_logs`.
- Batch where possible (5–20 items per call). Cache by content hash.

---

## 5. Pattern detection — the three-gate rule

Every detector must pass **all three** gates before firing:

```
fire IF  sample_size    >= n_min
    AND  effect_size    >= e_min
    AND  baseline_weeks >= b_min
```

A detector whose `b_min` is unmet is marked **suppressed** and shown as suppressed on `/methodology` with its reason — never silently absent.

**The investor-rotation detector has a mandatory four-condition guard** (PRD §14.3). Without it, it fires for every investor in a young database. Implement each condition as a separate guard with its own log line.

---

## 6. Ops hygiene

- Structured JSON logs with `run_id` threading through every stage.
- `run_logs` row per stage: started, finished, counts in/out, gemini calls, tokens, errors.
- Retries with exponential backoff; a dead-letter path to `quarantine`.
- **Graceful degradation.** A failed source degrades a section; it never breaks the digest. The last good digest is always servable. Never show a stack trace on a public page.
- **No invocation may approach the function timeout.** Every stage endpoint takes `?cursor=&limit=` and returns `{ processed, next_cursor }`. The dispatcher loops with a time budget.
- Secrets in env only. Never in the repo, never in logs, never in error messages.
- `CRON_SECRET` verified on every cron endpoint; `ADMIN_SECRET` on every mutating endpoint.

---

## 7. Critical correctness rules

These are the bugs that will silently ruin the product:

1. **The digest window is `last_digest_sent_at → now`, never a hardcoded 7 days.** Hardcoding produces duplicate deals across consecutive sends.
2. **`last_digest_sent_at` advances only on a successful send.** A failed send must not advance the window, or deals are lost permanently.
3. **The baseline is fixed at 8 weeks regardless of delivery cadence.**
4. **The daily template has no Patterns section, no LP talking points, no serendipity section.** A daily email cannot claim weekly patterns.
5. **Adjacency uses a vector shortlist before Gemini adjudication.** Without it you run `deals × portfolio` LLM calls per run.
6. **`adjacency_keywords` must be specific** ("embedded finance", "BNPL B2B"), never generic ("fintech"). Generic keywords match everything and produce a wall of false positives.
7. **Outlier detection requires `n >= 8` in the stage×sector bucket.** You cannot compute 2σ from 4 observations.
8. **Excluded sectors are a hard filter**, applied before scoring, not a negative weight.
9. **Market map clusters are pre-computed nightly**, never on page load.
10. **Natural-language search generates a validated filter object, never raw SQL.** Whitelist the fields.

---

## 8. Git hygiene

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`.
- Small, scoped commits with real messages describing *why*.
- Branch per feature. No direct commits to `main`.
- `README.md` maintained with setup, architecture, **assumptions**, and **limitations**. Write the limitations honestly — it reads as confidence, not weakness.
- `DECISIONS.md` logs every implementation decision made where the PRD was ambiguous.

---

## 9. When you are uncertain

- **Verify external facts.** Model IDs, SDK versions, free-tier limits and API shapes change. Check current documentation before relying on any version number or limit in the PRD. Where it says "verify", verify.
- **If the PRD is ambiguous:** implement the simplest defensible option, write it in `DECISIONS.md`, and flag it in your summary. Do not invent requirements.
- **If a milestone's acceptance criteria do not pass:** stop, report, fix. Do not advance.

---

## 10. The three sentences

Judge every implementation decision against these:

1. **Would this have caught the two adjacent deals before the board meeting?**
2. **Does this work for a fund that isn't Aarav?**
3. **Can he trust this number enough to repeat it to an LP?**

If a feature serves none of them, it is not in v1.
