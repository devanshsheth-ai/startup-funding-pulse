import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError, GoogleGenAI } from "@google/genai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { geminiCache } from "@/db/schema";
import { getEnv, requireEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { StageCounters } from "@/lib/run-log";
import { sha256 } from "@/pipeline/ingest/url";

/**
 * The single Gemini wrapper (CLAUDE.md §3). No other module imports the SDK.
 *
 * Every structured call:
 *  - loads a versioned prompt from /prompts (never inline),
 *  - sends responseMimeType "application/json" + a JSON Schema derived from
 *    the same Zod schema that validates the reply (one source of truth),
 *  - enforces the temperature ceiling for its task class,
 *  - retries transient failures with exponential backoff,
 *  - Zod-validates the output and throws GeminiOutputError (with the raw
 *    payload, for quarantine) when it does not conform,
 *  - logs token usage onto the calling stage's counters,
 *  - caches by sha256(model | prompt version | rendered prompt).
 */

export type GeminiTask = "classify" | "extract" | "adjudicate" | "narrate" | "filter_nl" | "label";

const TEMPERATURE_CEILING: Record<GeminiTask, number> = {
  classify: 0.2,
  extract: 0.2,
  adjudicate: 0.2,
  filter_nl: 0.2,
  label: 0.2,
  narrate: 0.4,
};

export class GeminiOutputError extends Error {
  constructor(
    message: string,
    readonly rawText: string | null,
  ) {
    super(message);
    this.name = "GeminiOutputError";
  }
}

export class GeminiUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "GeminiUnavailableError";
  }
}

// ─── Prompts ───────────────────────────────────────────────────────────────

export interface PromptRef {
  name: string; // e.g. "extract-deal"
  version: number; // e.g. 1 → prompts/extract-deal.v1.md
}

export function promptId(p: PromptRef): string {
  return `${p.name}.v${p.version}`;
}

const promptCache = new Map<string, string>();

export function loadPrompt(p: PromptRef): string {
  const id = promptId(p);
  let text = promptCache.get(id);
  if (text === undefined) {
    text = readFileSync(join(process.cwd(), "prompts", `${id}.md`), "utf8");
    promptCache.set(id, text);
  }
  return text;
}

/** `{{name}}` placeholders; every placeholder must be supplied. */
export function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key];
    if (v === undefined) throw new Error(`Prompt variable "${key}" not supplied`);
    return v;
  });
}

// ─── Schema conversion ─────────────────────────────────────────────────────

/**
 * Keywords Gemini's responseJsonSchema documents as supported. Anything else
 * (pattern, exclusiveMinimum, minLength, maxLength, …) makes the API reject
 * the request with INVALID_ARGUMENT, so it is dropped from the schema sent to
 * Gemini. The full Zod schema still validates every reply (D-035).
 */
const GEMINI_SCHEMA_KEYWORDS = new Set([
  "$id",
  "$defs",
  "$ref",
  "$anchor",
  "type",
  "format",
  "title",
  "description",
  "enum",
  "items",
  "prefixItems",
  // minItems/maxItems are supported but, nested, they multiply the decoding
  // grammar until the API rejects the schema; Zod enforces them instead.
  "minimum",
  "maximum",
  "anyOf",
  "oneOf",
  "properties",
  "additionalProperties",
  "required",
  "propertyOrdering",
]);

/** Zod → the JSON Schema subset Gemini accepts. */
export function toGeminiSchema(schema: z.ZodType): unknown {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        if (!GEMINI_SCHEMA_KEYWORDS.has(k)) continue;
        if ((k === "minimum" || k === "maximum") && typeof v === "number" && Math.abs(v) >= Number.MAX_SAFE_INTEGER) continue;
        if ((k === "properties" || k === "$defs") && v && typeof v === "object") {
          // Keys here are field names, not keywords: keep every one.
          out[k] = Object.fromEntries(Object.entries(v).map(([name, sub]) => [name, strip(sub)]));
        } else {
          out[k] = strip(v);
        }
      }
      return out;
    }
    return node;
  };
  return strip(json);
}

// ─── Client, pacing, retry ─────────────────────────────────────────────────

let client: GoogleGenAI | undefined;
function getClient(): GoogleGenAI {
  // 60 s per request: a hung call must not stall a stage past its budget.
  client ??= new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY"), httpOptions: { timeout: 60_000 } });
  return client;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let nextSlot = 0;

/** Spaces requests to stay under GEMINI_RPM (free-tier friendly by default). */
async function pace(): Promise<void> {
  const rpm = Number(getEnv().GEMINI_RPM ?? "10");
  const spacing = rpm > 0 ? Math.ceil(60_000 / rpm) : 0;
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + spacing;
  if (slot > now) await sleep(slot - now);
}

function isRetryable(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 429 || err.status >= 500;
  return err instanceof Error && (err.name === "AbortError" || /fetch failed|ECONNRESET|ETIMEDOUT|network/i.test(err.message));
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 4, baseMs = 2_000): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(baseMs * 2 ** (i - 1) + Math.floor(Math.random() * 500));
    await pace();
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isRetryable(err)) break;
    }
  }
  const status = last instanceof ApiError ? last.status : null;
  const msg = last instanceof Error ? last.message : String(last);
  // 4xx other than 429 means the request itself was rejected (schema, model id,
  // key) — a systemic problem, so stages pause rather than quarantine every
  // article, but the message must say "rejected", not "unavailable".
  const kind = status !== null && status >= 400 && status < 500 && status !== 429 ? "rejected the request" : "unavailable";
  throw new GeminiUnavailableError(`Gemini ${kind} (HTTP ${status ?? "n/a"}): ${msg.slice(0, 300)}`, status);
}

function modelId(): string {
  return requireEnv("GEMINI_MODEL");
}

// ─── Structured generation ─────────────────────────────────────────────────

export interface StructuredCall<T> {
  task: GeminiTask;
  prompt: PromptRef;
  vars: Record<string, string>;
  schema: z.ZodType<T>;
  temperature: number;
  counters?: StageCounters;
  /** Default true. Disable for calls whose answer must reflect live state. */
  cache?: boolean;
  maxOutputTokens?: number;
}

export interface StructuredResult<T> {
  data: T;
  tokens: number;
  cached: boolean;
  promptVersion: string;
}

export async function generateStructured<T>(call: StructuredCall<T>): Promise<StructuredResult<T>> {
  const ceiling = TEMPERATURE_CEILING[call.task];
  if (call.temperature > ceiling) {
    throw new Error(`temperature ${call.temperature} exceeds the ${ceiling} ceiling for task "${call.task}"`);
  }
  const model = modelId();
  const version = promptId(call.prompt);
  const text = renderPrompt(loadPrompt(call.prompt), call.vars);
  const useCache = call.cache !== false;
  const key = sha256(`${model}|${version}|${text}`);
  const db = getDb();

  if (useCache) {
    const [hit] = await db.select({ response: geminiCache.response }).from(geminiCache).where(eq(geminiCache.key, key)).limit(1);
    if (hit) {
      const parsed = call.schema.safeParse(hit.response);
      if (parsed.success) return { data: parsed.data, tokens: 0, cached: true, promptVersion: version };
    }
  }

  const response = await withRetry(() =>
    getClient().models.generateContent({
      model,
      contents: text,
      config: {
        temperature: call.temperature,
        responseMimeType: "application/json",
        responseJsonSchema: toGeminiSchema(call.schema),
        maxOutputTokens: call.maxOutputTokens ?? 8192,
      },
    }),
  );

  const tokens = response.usageMetadata?.totalTokenCount ?? 0;
  if (call.counters) {
    call.counters.geminiCalls += 1;
    call.counters.geminiTokens += tokens;
  }
  logger.debug("gemini call", { task: call.task, prompt: version, tokens, model });

  const raw = response.text ?? null;
  if (!raw) throw new GeminiOutputError(`Empty response (finish: ${response.candidates?.[0]?.finishReason ?? "unknown"})`, null);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new GeminiOutputError("Response was not valid JSON", raw.slice(0, 20_000));
  }
  const parsed = call.schema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new GeminiOutputError(`Schema validation failed: ${issues}`, raw.slice(0, 20_000));
  }

  if (useCache) {
    await db
      .insert(geminiCache)
      .values({ key, task: call.task, model, promptVersion: version, response: json as object, tokens })
      .onConflictDoNothing();
  }
  return { data: parsed.data, tokens, cached: false, promptVersion: version };
}

// ─── Embeddings ────────────────────────────────────────────────────────────

export const EMBED_BATCH = 50;

export function l2Normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm > 0 ? v.map((x) => x / norm) : v;
}

/**
 * Embeds texts with GEMINI_EMBEDDING_MODEL at the schema's dimension. Output
 * is always L2-normalised, which gemini-embedding-001 needs below 3072 dims
 * and is harmless for models that already normalise.
 */
export async function embedTexts(
  texts: string[],
  opts: { dimensions: number; taskType?: "SEMANTIC_SIMILARITY" | "CLUSTERING" | "RETRIEVAL_DOCUMENT"; counters?: StageCounters },
): Promise<number[][]> {
  const model = requireEnv("GEMINI_EMBEDDING_MODEL");
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const res = await withRetry(() =>
      getClient().models.embedContent({
        model,
        contents: batch,
        config: { outputDimensionality: opts.dimensions, taskType: opts.taskType ?? "SEMANTIC_SIMILARITY" },
      }),
    );
    if (opts.counters) opts.counters.geminiCalls += 1;
    const vectors = res.embeddings?.map((e) => e.values ?? []) ?? [];
    if (vectors.length !== batch.length || vectors.some((v) => v.length !== opts.dimensions)) {
      throw new GeminiOutputError(`Embedding shape mismatch (expected ${batch.length}×${opts.dimensions})`, null);
    }
    out.push(...vectors.map(l2Normalize));
  }
  return out;
}
