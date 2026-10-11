import { XMLParser } from "fast-xml-parser";
import { fetchText } from "@/lib/http";
import { htmlToText, parseDate, truncate } from "../text";
import { fetchedItemSchema, MAX_BODY_CHARS, type FetchedItem, type Parser } from "../types";

/**
 * RSS 2.0 / RDF / Atom → FetchedItem[]. Identity comes from the item link,
 * never the guid (see url.ts). Items without a usable link are skipped.
 */

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  cdataPropName: false,
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
  isArray: (name) => ["item", "entry", "category", "link"].includes(name),
});

type Node = Record<string, unknown>;

function isNode(v: unknown): v is Node {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (isNode(v)) return text(v["#text"]);
  if (Array.isArray(v)) return text(v[0]);
  return null;
}

function first(node: Node, keys: string[]): string | null {
  for (const k of keys) {
    const t = text(node[k]);
    if (t) return t;
  }
  return null;
}

function linkOf(node: Node): string | null {
  const links = node["link"];
  if (Array.isArray(links)) {
    // Atom: prefer rel="alternate" (or no rel) href; RSS: plain text.
    for (const l of links) {
      if (typeof l === "string" && l.trim()) return l.trim();
      if (isNode(l)) {
        const rel = typeof l["@_rel"] === "string" ? l["@_rel"] : "alternate";
        const href = l["@_href"];
        if (rel === "alternate" && typeof href === "string") return href;
        const t = text(l);
        if (t) return t;
      }
    }
  }
  const guid = node["guid"];
  // Only use guid as a link when it is explicitly a permalink URL.
  if (isNode(guid) && guid["@_isPermaLink"] !== "false") {
    const g = text(guid);
    if (g?.startsWith("http")) return g;
  }
  return null;
}

function categoriesOf(node: Node): string[] {
  const cats = node["category"];
  if (!Array.isArray(cats)) return [];
  return cats
    .map((c) => (isNode(c) && typeof c["@_term"] === "string" ? c["@_term"] : text(c)))
    .filter((c): c is string => !!c);
}

function authorOf(node: Node): string | null {
  const a = node["author"];
  if (isNode(a)) return text(a["name"]);
  return first(node, ["dc:creator", "author"]);
}

export function parseFeedXml(body: string): FetchedItem[] {
  const doc: unknown = xml.parse(body);
  if (!isNode(doc)) return [];

  let items: unknown[] = [];
  const rss = doc["rss"];
  const rdf = doc["rdf:RDF"];
  const feed = doc["feed"];
  if (isNode(rss) && isNode(rss["channel"])) items = (rss["channel"]["item"] as unknown[]) ?? [];
  else if (isNode(rdf)) items = (rdf["item"] as unknown[]) ?? [];
  else if (isNode(feed)) items = (feed["entry"] as unknown[]) ?? [];

  const out: FetchedItem[] = [];
  for (const raw of items) {
    if (!isNode(raw)) continue;
    const url = linkOf(raw);
    if (!url) continue;
    const bodyHtml = first(raw, ["content:encoded", "content", "description", "summary"]);
    const candidate = {
      url,
      headline: (() => {
        const h = first(raw, ["title"]);
        return h ? htmlToText(h).slice(0, 1000) || null : null;
      })(),
      author: authorOf(raw)?.slice(0, 300) ?? null,
      publishedAt: parseDate(first(raw, ["pubDate", "dc:date", "published", "updated"])),
      bodyText: truncate(bodyHtml ? htmlToText(bodyHtml) || null : null, MAX_BODY_CHARS),
      categories: categoriesOf(raw).slice(0, 50).map((c) => c.slice(0, 200)),
    };
    const parsed = fetchedItemSchema.safeParse(candidate);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export const rssParser: Parser = async (source) => {
  const { text: body } = await fetchText(source.url, {
    headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" },
  });
  return parseFeedXml(body);
};
