import { describe, expect, it } from "vitest";
import { crawlDelayFor, isAllowedByRobots, parseRobots } from "@/lib/robots";
import { parseLatest, parseRange } from "@/lib/fx";
import { prepareRows } from "@/pipeline/ingest/collect";
import { parseGnewsJson } from "@/pipeline/ingest/parsers/gnews";
import { parseListingHtml } from "@/pipeline/ingest/parsers/html-listing";
import { parseFeedXml } from "@/pipeline/ingest/parsers/rss";
import { htmlToText } from "@/pipeline/ingest/text";
import type { FetchedItem } from "@/pipeline/ingest/types";
import { normalizeUrl, urlHash } from "@/pipeline/ingest/url";

describe("normalizeUrl / urlHash", () => {
  it("strips tracking params, fragments, trailing slash; lowercases host; sorts params", () => {
    expect(normalizeUrl("HTTP://Example.COM/a/b/?utm_source=x&b=2&a=1&fbclid=z#frag")).toBe("https://example.com/a/b?a=1&b=2");
  });
  it("keeps meaningful params and root path", () => {
    expect(normalizeUrl("https://x.com/?id=5")).toBe("https://x.com/?id=5");
  });
  it("maps tracking variants of the same article to one identity", () => {
    expect(urlHash("https://inc42.com/buzz/foo/?utm_medium=rss")).toBe(urlHash("https://INC42.com/buzz/foo"));
  });
});

describe("robots", () => {
  const txt = `
User-agent: GPTBot
Disallow: /

User-agent: *
Crawl-delay: 20
Disallow: /search
Disallow: */feed/*
Allow: /search/public$
`;
  const groups = parseRobots(txt);
  it("applies the * group to our agent, not other bots' groups", () => {
    expect(isAllowedByRobots(groups, "FundingPulseBot", "/articles/x")).toBe(true);
  });
  it("honours Disallow prefixes and wildcards", () => {
    expect(isAllowedByRobots(groups, "FundingPulseBot", "/search?q=a")).toBe(false);
    expect(isAllowedByRobots(groups, "FundingPulseBot", "/blog/feed/")).toBe(false);
  });
  it("lets the longer Allow win, with $ anchoring", () => {
    expect(isAllowedByRobots(groups, "FundingPulseBot", "/search/public")).toBe(true);
    expect(isAllowedByRobots(groups, "FundingPulseBot", "/search/public/x")).toBe(false);
  });
  it("selects a specific group when one names the agent", () => {
    expect(isAllowedByRobots(groups, "GPTBot", "/articles/x")).toBe(false);
  });
  it("reads crawl-delay", () => {
    expect(crawlDelayFor(groups, "FundingPulseBot")).toBe(20);
  });
  it("Google News style: Disallow / with narrow allows blocks /rss/search", () => {
    const g = parseRobots("User-agent: *\nDisallow: /\nAllow: /$\nAllow: /topics/");
    expect(isAllowedByRobots(g, "FundingPulseBot", "/rss/search?q=x")).toBe(false);
    expect(isAllowedByRobots(g, "FundingPulseBot", "/")).toBe(true);
  });
});

describe("RSS / Atom parsing", () => {
  it("parses RSS 2.0 and ignores a constant guid", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
      <item><title>Acme raises &#8377;50 Cr in Series A</title><link>https://ex.com/a?utm_source=rss</link><guid isPermaLink="false">same</guid>
        <pubDate>Fri, 09 Oct 2026 10:00:00 +0530</pubDate><dc:creator>Jane</dc:creator><category>Funding</category>
        <content:encoded><![CDATA[<p>Acme <b>raised</b> funds.</p><p>Led by X.</p>]]></content:encoded></item>
      <item><title>Beta closes seed</title><link>https://ex.com/b</link><guid isPermaLink="false">same</guid></item>
    </channel></rss>`;
    const items = parseFeedXml(xml);
    expect(items).toHaveLength(2);
    expect(items[0]?.headline).toBe("Acme raises ₹50 Cr in Series A");
    expect(items[0]?.author).toBe("Jane");
    expect(items[0]?.categories).toEqual(["Funding"]);
    expect(items[0]?.bodyText).toBe("Acme raised funds.\nLed by X.");
    expect(items[0]?.publishedAt?.toISOString()).toBe("2026-10-09T04:30:00.000Z");
    expect(new Set(items.map((i) => i.url)).size).toBe(2);
  });

  it("parses Atom with alternate links", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Gamma acquires Delta</title>
      <link rel="self" href="https://ex.com/self"/><link rel="alternate" href="https://ex.com/gamma"/>
      <updated>2026-10-01T00:00:00Z</updated><summary>text</summary><author><name>Ann</name></author></entry></feed>`;
    const [item] = parseFeedXml(xml);
    expect(item?.url).toBe("https://ex.com/gamma");
    expect(item?.author).toBe("Ann");
  });

  it("returns nothing for non-feed XML", () => {
    expect(parseFeedXml("<html><body>nope</body></html>")).toEqual([]);
  });
});

describe("HTML listing parsing", () => {
  it("extracts same-host article links matching the pattern, keeping the longest anchor text", () => {
    const html = `<a href="/zinara-better-nutrition-pocket-early-stage-funding"><img/></a>
      <a href="/zinara-better-nutrition-pocket-early-stage-funding">Zinara, Better Nutrition pocket early-stage funding</a>
      <a href="/about">About us page link text here</a>
      <a href="https://other.com/some-long-article-slug-here-x">Elsewhere article that is long enough</a>`;
    const items = parseListingHtml(html, "https://www.vccircle.com/", {
      linkPattern: "^/[a-z0-9]+(?:-[a-z0-9]+){3,}$",
      minHeadlineLength: 25,
      maxItems: 60,
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.headline).toBe("Zinara, Better Nutrition pocket early-stage funding");
    expect(items[0]?.url).toBe("https://www.vccircle.com/zinara-better-nutrition-pocket-early-stage-funding");
  });
});

describe("GNews parsing", () => {
  it("maps articles and rejects malformed payloads", () => {
    const items = parseGnewsJson(
      JSON.stringify({
        totalArticles: 1,
        articles: [{ title: "X raises $5M", description: "d", content: "c", url: "https://n.com/x", publishedAt: "2026-10-10T05:00:00Z", source: { name: "Mint" } }],
      }),
    );
    expect(items[0]?.categories).toEqual(["via:Mint"]);
    expect(items[0]?.bodyText).toBe("d\n\nc");
    expect(() => parseGnewsJson(JSON.stringify({ errors: ["bad key"] }))).toThrow();
  });
});

describe("prepareRows", () => {
  const now = new Date("2026-10-11T00:00:00Z");
  const item = (url: string, publishedAt: Date | null): FetchedItem => ({
    url,
    headline: "h",
    author: null,
    publishedAt,
    bodyText: null,
    categories: [],
  });
  it("dedupes within a batch by normalised URL, drops stale items, clamps future dates", () => {
    const { rows, tooOld } = prepareRows(
      [
        item("https://a.com/x?utm_source=1", new Date("2026-10-10")),
        item("https://A.com/x/", new Date("2026-10-10")),
        item("https://a.com/old", new Date("2026-08-01")),
        item("https://a.com/future", new Date("2027-01-01")),
        item("https://a.com/undated", null),
      ],
      7,
      "run_x",
      now,
    );
    expect(rows.map((r) => r.url)).toEqual(["https://a.com/x", "https://a.com/future", "https://a.com/undated"]);
    expect(tooOld).toBe(1);
    expect(rows[1]?.publishedAt).toEqual(now);
    expect(rows.every((r) => r.sourceId === 7 && r.urlHash?.length === 64)).toBe(true);
  });
});

describe("FX parsing", () => {
  it("parses latest and range responses", () => {
    expect(parseLatest('{"amount":1,"base":"USD","date":"2026-10-09","rates":{"INR":96.73}}')).toEqual({ date: "2026-10-09", usdInr: 96.73 });
    expect(parseRange('{"rates":{"2026-07-02":{"INR":95.39},"2026-07-01":{"INR":95.25}}}').map((r) => r.date)).toEqual(["2026-07-01", "2026-07-02"]);
    expect(() => parseLatest('{"date":"x","rates":{}}')).toThrow();
  });
});

describe("htmlToText", () => {
  it("drops scripts and keeps paragraph breaks", () => {
    expect(htmlToText("<p>a&nbsp;b</p><script>x()</script><p>c</p>")).toBe("a b\nc");
  });
});
