import { z } from "zod";

/** One article as yielded by any parser, validated before it is stored. */
export const fetchedItemSchema = z.object({
  url: z.string().url(),
  headline: z.string().trim().min(1).max(1000).nullable(),
  author: z.string().trim().max(300).nullable(),
  publishedAt: z.date().nullable(),
  bodyText: z.string().nullable(),
  categories: z.array(z.string().trim().min(1).max(200)).max(50),
});

export type FetchedItem = z.infer<typeof fetchedItemSchema>;

export interface SourceRow {
  id: number;
  name: string;
  type: string;
  url: string;
  parser: string;
  config?: unknown;
}

export type Parser = (source: SourceRow) => Promise<FetchedItem[]>;

export const MAX_BODY_CHARS = 20_000;
