import { Body, Container, Head, Hr, Html, Link, Preview, Section, Text } from "@react-email/components";
import { render, toPlainText } from "@react-email/render";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { SIMULATED_PORTFOLIO_FOOTER } from "@/lib/copy";
import { appUrl, loadDealCards, withUtm, type DealCard } from "@/pipeline/digest";
import { C, DealBlock, S, usd } from "./parts";

/**
 * Alert email (PRD §15.3). The subject does the work; the body is, in order:
 * what happened · why it is flagged · the deal card with provenance · what
 * else moved around the same tracked company in 30 days · portfolio link.
 * Templated from stored data: no generated prose, "tracked company" phrasing.
 */

const num = z.coerce.number();
const numN = z.coerce.number().nullable();

interface AlertEmailData {
  title: string;
  body: string;
  severity: string;
  profileId: string;
  portfolio: string | null;
  rationale: string | null;
  deal: DealCard | null;
  event: { headline: string; date: string; sources: { publication: string | null; url: string }[] } | null;
  related: { company: string; relationship: string; stage: string; amountUsd: number | null; announced: string; url: string | null }[];
}

const COLOR: Record<string, string> = { critical: C.red, high: C.amber, medium: "#a16207", info: C.blue };

export function AlertEmail({ a }: { a: AlertEmailData }) {
  const base = appUrl();
  return (
    <Html lang="en">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Preview>{a.title}</Preview>
      <Body style={S.body}>
        <Container style={S.container}>
          <Text style={S.small}>Dealscope alert · {a.severity}</Text>
          <Text style={{ ...S.h1, fontSize: "19px", lineHeight: "26px" }}>{a.title}</Text>

          <Section style={{ ...S.alert, borderLeftColor: COLOR[a.severity] ?? C.red }}>
            <Text style={{ ...S.p, margin: 0 }}>
              <strong>What happened.</strong> {a.body}
            </Text>
            {a.rationale && !a.body.includes(a.rationale) ? (
              <Text style={{ ...S.p, margin: "6px 0 0" }}>
                <strong>Why it is flagged.</strong> {a.rationale}
              </Text>
            ) : null}
          </Section>

          {a.deal ? <DealBlock d={a.deal} mode="alert" showScore /> : null}
          {a.event ? (
            <Section style={S.card}>
              <Text style={{ ...S.p, margin: 0, fontWeight: 600 }}>{a.event.headline}</Text>
              <Text style={S.small}>
                {a.event.date} ·{" "}
                {a.event.sources.map((s, i) => (
                  <span key={s.url}>
                    {i ? " · " : ""}
                    <Link href={withUtm(s.url, "alert")} style={S.link}>
                      {s.publication ?? "source"}
                    </Link>
                  </span>
                ))}
              </Text>
            </Section>
          ) : null}

          {a.portfolio ? (
            <>
              <Text style={S.h2}>Also around {a.portfolio} in the last 30 days</Text>
              {a.related.length === 0 ? (
                <Text style={S.small}>No other adjacent raises.</Text>
              ) : (
                a.related.map((r) => (
                  <Text key={r.company + r.announced} style={S.small}>
                    {r.announced} · {r.relationship.replace("_", " ")} ·{" "}
                    {r.url ? (
                      <Link href={withUtm(r.url, "alert")} style={S.link}>
                        {r.company}
                      </Link>
                    ) : (
                      r.company
                    )}{" "}
                    · {r.stage} · {usd(r.amountUsd)}
                  </Text>
                ))
              )}
            </>
          ) : null}

          <Text style={{ ...S.p, marginTop: "16px" }}>
            <Link href={`${base}/portfolio?profile=${a.profileId}`} style={S.link}>
              Open the portfolio view
            </Link>{" "}
            ·{" "}
            <Link href={`${base}/alerts?profile=${a.profileId}`} style={S.link}>
              Alert inbox
            </Link>{" "}
            ·{" "}
            <Link href={`${base}/settings?profile=${a.profileId}#mandate`} style={S.link}>
              Alert settings
            </Link>
          </Text>
          <Hr style={{ borderColor: C.line, margin: "20px 0 10px" }} />
          <Text style={S.small}>{SIMULATED_PORTFOLIO_FOOTER}</Text>
        </Container>
      </Body>
    </Html>
  );
}

/** Load everything an alert email needs from the stored alert row and render it. */
export async function renderAlertEmail(alertId: number): Promise<{ subject: string; html: string; text: string } | null> {
  const db = getDb();
  const row = z
    .array(z.object({ id: num, profile_id: z.string(), severity: z.string(), title: z.string(), body: z.string(), portfolio_id: numN, deal_id: z.string().nullable(), event_id: z.string().nullable(), portfolio: z.string().nullable() }))
    .parse(
      (
        await db.execute(sql`SELECT a.id, a.profile_id, a.severity, a.title, a.body, a.portfolio_id, a.deal_id, a.event_id, p.name AS portfolio
                             FROM alerts a LEFT JOIN portfolio p ON p.id = a.portfolio_id WHERE a.id = ${alertId}`)
      ).rows,
    )[0];
  if (!row) return null;
  const [deal] = row.deal_id ? await loadDealCards(row.profile_id, [row.deal_id], null) : [];
  let rationale: string | null = null;
  if (row.deal_id && row.portfolio_id !== null) {
    const r = (await db.execute(sql`SELECT rationale FROM adjacency_edges WHERE portfolio_id = ${row.portfolio_id} AND deal_id = ${row.deal_id}`)).rows[0] as { rationale?: string } | undefined;
    rationale = r?.rationale ?? null;
  }
  let event: AlertEmailData["event"] = null;
  if (row.event_id) {
    const e = (await db.execute(sql`SELECT headline, event_date::text AS date FROM events WHERE id = ${row.event_id}`)).rows[0] as { headline: string; date: string } | undefined;
    const srcs = z.array(z.object({ publication: z.string().nullable(), url: z.string() })).parse((await db.execute(sql`SELECT publication, url FROM event_sources WHERE event_id = ${row.event_id} ORDER BY is_primary DESC`)).rows);
    if (e) event = { headline: e.headline, date: e.date, sources: srcs };
  }
  const related =
    row.portfolio_id === null
      ? []
      : z
          .array(z.object({ company: z.string(), relationship: z.string(), stage: z.string(), amount_usd: numN, announced: z.string(), url: z.string().nullable() }))
          .parse(
            (
              await db.execute(sql`
                SELECT co.canonical_name AS company, ae.relationship, d.round_stage AS stage, d.amount_usd, d.announced_date::text AS announced,
                       (SELECT ds.url FROM deal_sources ds WHERE ds.deal_id = d.id ORDER BY ds.is_primary DESC LIMIT 1) AS url
                FROM adjacency_edges ae JOIN deals d ON d.id = ae.deal_id JOIN companies co ON co.id = d.company_id
                WHERE ae.portfolio_id = ${row.portfolio_id} AND d.announced_date >= current_date - 30 AND ae.deal_id IS DISTINCT FROM ${row.deal_id}
                ORDER BY d.announced_date DESC LIMIT 8`)
            ).rows,
          )
          .map((r) => ({ company: r.company, relationship: r.relationship, stage: r.stage, amountUsd: r.amount_usd, announced: r.announced, url: r.url }));
  const data: AlertEmailData = { title: row.title, body: row.body, severity: row.severity, profileId: row.profile_id, portfolio: row.portfolio, rationale, deal: deal ?? null, event, related };
  const html = await render(<AlertEmail a={data} />);
  return { subject: row.title, html, text: toPlainText(html) };
}
