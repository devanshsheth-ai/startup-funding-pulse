import { z } from "zod";
import citySeed from "../../seed/city-mappings.json";
import investorSeed from "../../seed/investor-aliases.json";
import stageSeed from "../../seed/stage-mappings.json";
import sectorSeed from "../../seed/sector-taxonomy.json";

/**
 * Canonical vocabularies loaded from seed/ (configuration, not data) and
 * validated once at import. Every enum the LLM may emit is defined here.
 */

const sectorFile = z.object({
  sectors: z.array(z.object({ name: z.string().min(1), hints: z.array(z.string()) })).min(1),
});
const stageFile = z.object({
  ordered: z.array(z.string()).min(1),
  non_ordinal: z.array(z.string()).min(1),
  mappings: z.record(z.string(), z.string()),
});
const cityFile = z.object({ mappings: z.record(z.string(), z.string()) });
const aliasFile = z.object({ investors: z.record(z.string(), z.array(z.string())) });

const sectors = sectorFile.parse(sectorSeed).sectors;
const stages = stageFile.parse(stageSeed);
const cities = cityFile.parse(citySeed).mappings;
const investorAliases = aliasFile.parse(investorSeed).investors;

export const SECTORS = sectors.map((s) => s.name) as readonly string[];
export const SECTOR_HINTS: ReadonlyArray<{ name: string; hints: string[] }> = sectors;

export const ORDERED_STAGES = stages.ordered as readonly string[];
export const NON_ORDINAL_STAGES = stages.non_ordinal as readonly string[];
export const ALL_STAGES = [...ORDERED_STAGES, ...NON_ORDINAL_STAGES] as readonly string[];

for (const target of Object.values(stages.mappings)) {
  if (!ALL_STAGES.includes(target)) throw new Error(`stage-mappings.json maps to unknown stage "${target}"`);
}

export const STAGE_MAPPINGS: Readonly<Record<string, string>> = stages.mappings;
export const CITY_MAPPINGS: Readonly<Record<string, string>> = cities;
export const INVESTOR_ALIASES: Readonly<Record<string, string[]>> = investorAliases;

export const EVENT_TYPES = ["ma", "shutdown", "ipo_filing", "layoff", "people_move", "fund_close", "financial_result"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const CLASSIFY_TYPES = ["funding", ...EVENT_TYPES, "none"] as const;
export type ClassifyType = (typeof CLASSIFY_TYPES)[number];

export const BUSINESS_MODELS = ["B2B", "B2C", "B2B2C", "marketplace", "SaaS", "D2C"] as const;
export const AMOUNT_UNITS = ["crore", "lakh", "million", "billion", "absolute"] as const;
export const CURRENCIES = ["INR", "USD"] as const;
export const AMOUNT_CONFIDENCE = ["reported", "estimated", "undisclosed"] as const;
export const MOVE_TYPES = ["joined", "departed", "promoted", "founded"] as const;

export function isSector(v: string): boolean {
  return SECTORS.includes(v);
}

/** Position on the ordered ladder, or -1 for non-ordinal stages. */
export function stageIndex(stage: string): number {
  return ORDERED_STAGES.indexOf(stage);
}
