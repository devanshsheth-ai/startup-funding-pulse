import { Body, Container, Head, Html, Preview, Section, Text } from "@react-email/components";
import type { DigestContent } from "@/pipeline/digest";
import { AdjacencySection, C, DealBlock, EventLine, Footer, S, SectionTitle, usd } from "./parts";

/**
 * Daily digest — PRD §16.2. Deliberately a different document: no Patterns,
 * no LP talking points, no serendipity (a day cannot carry weekly claims).
 */
export function DailyDigest({ c }: { c: DigestContent }) {
  const mode = c.mode;
  const deals = [...c.ranked.act_now, ...c.ranked.high, ...c.ranked.relevant];
  const events = [...c.exits, ...c.fundCloses, ...c.founders];
  return (
    <Html lang="en">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Preview>{c.headline}</Preview>
      <Body style={S.body}>
        <Container style={S.container}>
          {/* 1. Header */}
          <Text style={S.small}>
            Daily note · {c.profile.name} · {c.window.end}
          </Text>
          {/* 2. Headline + compact KPI line */}
          <Text style={S.h1}>{c.headline}</Text>
          <Section style={{ ...S.card, backgroundColor: C.bg }}>
            <Text style={S.p}>
              Today: <strong>{c.kpis.deals}</strong> deals · <strong>{usd(c.kpis.capitalUsd)}</strong>
              {c.rolling7d ? (
                <>
                  {" "}
                  · last 7 days: {c.rolling7d.deals} deals, {usd(c.rolling7d.capitalUsd)}
                </>
              ) : null}
            </Text>
          </Section>

          {/* 3. Alerts: watchlist + adjacency */}
          {c.watchlistHits.length ? (
            <>
              <SectionTitle>🔴 Watchlist</SectionTitle>
              {c.watchlistHits.map((d) => (
                <DealBlock key={d.id} d={d} mode={mode} compact />
              ))}
            </>
          ) : null}
          <AdjacencySection c={c} mode={mode} />

          {/* 4. Today's deals */}
          <SectionTitle>Today&apos;s deals</SectionTitle>
          {deals.length ? deals.slice(0, 12).map((d) => <DealBlock key={d.id} d={d} mode={mode} compact />) : <Text style={S.small}>No ranked deals today.</Text>}

          {/* 5. Rolling 7-day context (no pattern claims) */}
          {c.dailyContext ? (
            <>
              <SectionTitle>Last 7 days in context</SectionTitle>
              <Text style={S.p}>{c.dailyContext.text}</Text>
              <Text style={S.small}>{c.dailyContext.statBasis}</Text>
            </>
          ) : null}

          {/* 6. Events */}
          {events.length ? (
            <>
              <SectionTitle>Events</SectionTitle>
              {events.map((e) => (
                <EventLine key={e.id} e={e} mode={mode} />
              ))}
            </>
          ) : null}

          {/* 7. Footer */}
          <Footer c={c} />
        </Container>
      </Body>
    </Html>
  );
}
