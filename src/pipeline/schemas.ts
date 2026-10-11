import { z } from "zod";
import {
  ALL_STAGES,
  AMOUNT_CONFIDENCE,
  AMOUNT_UNITS,
  BUSINESS_MODELS,
  CLASSIFY_TYPES,
  CURRENCIES,
  EVENT_TYPES,
  MOVE_TYPES,
  SECTORS,
} from "@/lib/taxonomy";

/**
 * Gemini output contracts for Stages A and B. These Zod schemas are sent to
 * Gemini as the response JSON Schema AND used to validate the reply, so the
 * contract and the check can never drift. Every extracted field is nullable:
 * the prompt instructs "return null if the article does not state this".
 */

const tuple = (xs: readonly string[]) => xs as [string, ...string[]];

export const sectorEnum = z.enum(tuple(SECTORS));
export const stageEnum = z.enum(tuple(ALL_STAGES));

const isoDateOrNull = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .describe("YYYY-MM-DD, or null if not stated");

const partialDateOrNull = z
  .string()
  .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/)
  .nullable()
  .describe("YYYY, YYYY-MM or YYYY-MM-DD as precise as the article states, or null");

const nameList = z.array(z.string().min(1).max(200)).max(40);

export const moneySchema = z
  .object({
    value: z.number().positive().nullable().describe("The number as written, e.g. 120 for ₹120 crore"),
    currency: z.enum(tuple(CURRENCIES)).nullable(),
    unit: z.enum(tuple(AMOUNT_UNITS)).nullable(),
    raw: z.string().max(200).nullable().describe("Verbatim amount text from the article"),
  })
  .describe("An amount exactly as stated; all null if not stated");

// ─── Stage A: classify ─────────────────────────────────────────────────────

export const classifyResultSchema = z.object({
  results: z
    .array(
      z.object({
        article_id: z.number().int(),
        is_relevant: z.boolean(),
        event_type: z.enum(tuple(CLASSIFY_TYPES)),
        confidence: z.number().min(0).max(1),
        reason: z.string().max(200),
      }),
    )
    .max(25),
});
export type ClassifyResult = z.infer<typeof classifyResultSchema>;

// ─── Stage B: funding ──────────────────────────────────────────────────────

export const extractedDealSchema = z.object({
  company_name: z.string().min(1).max(200),
  company_aliases: nameList,
  company_description: z
    .string()
    .max(400)
    .nullable()
    .describe("One sentence on what the company does and for whom, using only the article"),
  domain: z.string().max(200).nullable(),
  round_stage: stageEnum.nullable(),
  stage_raw: z.string().max(100).nullable(),
  amount: moneySchema,
  amount_confidence: z.enum(tuple(AMOUNT_CONFIDENCE)).nullable(),
  announced_date: isoDateOrNull,
  sector_primary: sectorEnum.nullable(),
  sector_secondary: z.array(sectorEnum).max(3),
  sub_sector: z.string().max(100).nullable(),
  business_model: z.enum(tuple(BUSINESS_MODELS)).nullable(),
  hq_city: z.string().max(100).nullable(),
  investors_lead: nameList,
  investors_participating: nameList,
  investors_existing: nameList,
  founders: z
    .array(
      z.object({
        name: z.string().min(1).max(150),
        previous_company: z.string().max(150).nullable().describe("Former employer if the article states one"),
      }),
    )
    .max(10),
  founded_year: z.number().int().min(1900).max(2100).nullable(),
  valuation: moneySchema,
  prior_round_stage: stageEnum.nullable(),
  prior_round_date: partialDateOrNull,
  total_raised_to_date: moneySchema,
  extraction_confidence: z.number().min(0).max(1),
});
export type ExtractedDeal = z.infer<typeof extractedDealSchema>;

export const extractDealsResponseSchema = z.object({
  articles: z
    .array(
      z.object({
        article_id: z.number().int(),
        deals: z.array(extractedDealSchema).max(30),
      }),
    )
    .max(12),
});

// ─── Stage B: events ───────────────────────────────────────────────────────

export const extractedEventSchema = z.object({
  event_type: z.enum(tuple(EVENT_TYPES)),
  summary: z.string().min(1).max(300).describe("One factual sentence describing the event"),
  company_name: z.string().max(200).nullable().describe("Subject company: target, filer, startup or employer"),
  counterparty_name: z.string().max(200).nullable().describe("Acquirer for M&A; otherwise null"),
  amount: moneySchema,
  event_date: isoDateOrNull,
  sector_primary: sectorEnum.nullable(),
  hq_city: z.string().max(100).nullable(),
  person_name: z.string().max(150).nullable(),
  person_role: z.string().max(150).nullable(),
  move_type: z.enum(tuple(MOVE_TYPES)).nullable(),
  from_company: z.string().max(200).nullable(),
  to_company: z.string().max(200).nullable(),
  fund_name: z.string().max(200).nullable(),
  fund_size: moneySchema,
  fund_vintage: z.number().int().min(1990).max(2100).nullable(),
  stated_focus: z.array(z.string().max(100)).max(10),
  extraction_confidence: z.number().min(0).max(1),
});
export type ExtractedEvent = z.infer<typeof extractedEventSchema>;

export const extractEventsResponseSchema = z.object({
  articles: z
    .array(
      z.object({
        article_id: z.number().int(),
        events: z.array(extractedEventSchema).max(30),
      }),
    )
    .max(12),
});
