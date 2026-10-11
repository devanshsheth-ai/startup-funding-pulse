import { z } from "zod";
import { requireEnv } from "@/lib/env";
import { fetchText } from "@/lib/http";
import { parseDate, truncate } from "../text";
import { fetchedItemSchema, MAX_BODY_CHARS, type FetchedItem, type Parser } from "../types";

/**
 * GNews search API (Tier 2). The source row's `url` is the full search URL
 * without the key; the key is appended from env at request time so it never
 * lands in the database or the logs.
 */

const responseSchema = z.object({
  articles: z.array(
    z.object({
      title: z.string().nullish(),
      description: z.string().nullish(),
      content: z.string().nullish(),
      url: z.string(),
      publishedAt: z.string().nullish(),
      source: z.object({ name: z.string().nullish() }).nullish(),
    }),
  ),
});

export function parseGnewsJson(body: string): FetchedItem[] {
  const data = responseSchema.parse(JSON.parse(body));
  const out: FetchedItem[] = [];
  for (const a of data.articles) {
    const parsed = fetchedItemSchema.safeParse({
      url: a.url,
      headline: a.title?.trim().slice(0, 1000) || null,
      author: null,
      publishedAt: parseDate(a.publishedAt ?? null),
      bodyText: truncate([a.description, a.content].filter(Boolean).join("\n\n") || null, MAX_BODY_CHARS),
      categories: a.source?.name ? [`via:${a.source.name}`] : [],
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export const gnewsParser: Parser = async (source) => {
  const key = requireEnv("NEWS_API_KEY");
  const url = new URL(source.url);
  url.searchParams.set("apikey", key);
  const { text } = await fetchText(url.toString(), { skipRobots: true, headers: { Accept: "application/json" } });
  return parseGnewsJson(text);
};
