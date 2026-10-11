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
