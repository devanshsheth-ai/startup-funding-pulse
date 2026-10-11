import { parse } from "node-html-parser";
import { z } from "zod";
import { fetchText } from "@/lib/http";
import { decodeEntities } from "../text";
import { absoluteUrl } from "../url";
import { fetchedItemSchema, type FetchedItem, type Parser } from "../types";

/**
 * Generic listing-page parser for sources without a working feed. Extracts
 * article links whose path matches `linkPattern`, using the anchor text as
 * the headline. Listing pages carry no body or date: the article body is
 * fetched later, only for items the filter marks relevant (D-017).
 */

export const htmlListingConfigSchema = z.object({
  linkPattern: z.string().min(1),
  minHeadlineLength: z.number().int().min(1).default(25),
  maxItems: z.number().int().min(1).max(200).default(60),
});

export type HtmlListingConfig = z.infer<typeof htmlListingConfigSchema>;

export function parseListingHtml(html: string, pageUrl: string, config: HtmlListingConfig): FetchedItem[] {
  const pattern = new RegExp(config.linkPattern);
  const pageHost = new URL(pageUrl).host;
  const best = new Map<string, string>(); // url → longest anchor text seen

  for (const a of parse(html).querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (!href) continue;
    const abs = absoluteUrl(href, pageUrl);
    if (!abs) continue;
    const u = new URL(abs);
    if (u.host !== pageHost || !pattern.test(u.pathname)) continue;
    const headline = decodeEntities(a.textContent).replace(/\s+/g, " ").trim();
    const prev = best.get(abs) ?? "";
    if (headline.length > prev.length) best.set(abs, headline);
  }

  const out: FetchedItem[] = [];
  for (const [url, headline] of best) {
    if (headline.length < config.minHeadlineLength) continue;
    const parsed = fetchedItemSchema.safeParse({
      url,
      headline: headline.slice(0, 1000),
      author: null,
      publishedAt: null,
      bodyText: null,
      categories: [],
    });
    if (parsed.success) out.push(parsed.data);
    if (out.length >= config.maxItems) break;
  }
  return out;
}

export const htmlListingParser: Parser = async (source) => {
  const config = htmlListingConfigSchema.parse(source.config ?? {});
  const { text, finalUrl } = await fetchText(source.url, { headers: { Accept: "text/html" } });
  return parseListingHtml(text, finalUrl, config);
};
