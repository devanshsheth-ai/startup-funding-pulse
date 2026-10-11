import type { Parser } from "../types";
import { gnewsParser } from "./gnews";
import { htmlListingParser } from "./html-listing";
import { rssParser } from "./rss";

/** `sources.parser` → parser module. Adding a source never means adding a fetcher. */
export const PARSERS: Readonly<Record<string, Parser>> = {
  rss: rssParser,
  html_listing: htmlListingParser,
  gnews: gnewsParser,
};

export function getParser(key: string): Parser | undefined {
  return PARSERS[key];
}
