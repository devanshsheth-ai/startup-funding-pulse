import { parse, type HTMLElement } from "node-html-parser";
import { fetchText } from "@/lib/http";
import { decodeEntities, htmlToText, parseDate } from "./text";
import { MAX_BODY_CHARS } from "./types";

/**
 * Article page → main text. Order of preference:
 *  1. JSON-LD NewsArticle/Article `articleBody` (most Indian news sites ship it)
 *  2. the densest block of <p> text inside <article>/<main>/<body>
 * Also reports <link rel="canonical"> and JSON-LD datePublished.
 */

export interface ArticleContent {
  text: string | null;
  canonicalUrl: string | null;
  publishedAt: Date | null;
}

type Json = unknown;

function collectLd(node: Json, out: Record<string, unknown>[]): void {
  if (Array.isArray(node)) {
    for (const n of node) collectLd(n, out);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    out.push(obj);
    if (obj["@graph"]) collectLd(obj["@graph"], out);
  }
}

function fromJsonLd(root: HTMLElement): { body: string | null; published: Date | null } {
  const nodes: Record<string, unknown>[] = [];
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      collectLd(JSON.parse(s.textContent), nodes);
    } catch {
      // Malformed JSON-LD is common; ignore it.
    }
  }
  for (const n of nodes) {
    const type = n["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (!types.some((t) => typeof t === "string" && /Article|NewsArticle|Report|BlogPosting/.test(t))) continue;
    const body = typeof n["articleBody"] === "string" ? htmlToText(n["articleBody"]) : null;
    const published = parseDate(n["datePublished"]);
    if (body && body.length > 200) return { body, published };
    if (published) return { body: null, published };
  }
  return { body: null, published: null };
}

function densestText(root: HTMLElement): string | null {
  for (const sel of ["script", "style", "noscript", "nav", "header", "footer", "aside", "form", "figure"]) {
    for (const el of root.querySelectorAll(sel)) el.remove();
  }
  const containers = [...root.querySelectorAll("article"), ...root.querySelectorAll("main")];
  const scope = containers.length ? containers : [root];
  let best: string[] = [];
  for (const c of scope) {
    const paras = c
      .querySelectorAll("p")
      .map((p) => decodeEntities(p.textContent).replace(/\s+/g, " ").trim())
      .filter((t) => t.length >= 40);
    if (paras.join(" ").length > best.join(" ").length) best = paras;
  }
  const text = best.join("\n");
  return text.length >= 200 ? text : null;
}

export function extractArticle(html: string, pageUrl: string): ArticleContent {
  const root = parse(html);
  const canonicalHref = root.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;
  let canonicalUrl: string | null = null;
  if (canonicalHref) {
    try {
      canonicalUrl = new URL(canonicalHref, pageUrl).toString();
    } catch {
      canonicalUrl = null;
    }
  }
  const ld = fromJsonLd(root);
  const text = ld.body ?? densestText(root);
  return { text: text ? text.slice(0, MAX_BODY_CHARS) : null, canonicalUrl, publishedAt: ld.published };
}

export async function fetchArticle(url: string): Promise<ArticleContent> {
  const { text, finalUrl } = await fetchText(url, { headers: { Accept: "text/html" }, retries: 1, maxWaitMs: 3_000 });
  return extractArticle(text, finalUrl);
}
