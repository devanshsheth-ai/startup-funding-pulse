import { Body, Container, Head, Html, Link, Preview, Section, Text } from "@react-email/components";
import type { DigestContent } from "@/pipeline/digest";
import { withUtm } from "@/pipeline/digest";
import { AdjacencySection, C, DealBlock, EventLine, Footer, S, SectionTitle, usd } from "./parts";

/** Weekly digest — section order per PRD §16.1. */
export function WeeklyDigest({ c }: { c: DigestContent }) {
  const mode = c.mode;
  const wow = c.kpis.prevDeals ? Math.round(((c.kpis.deals - c.kpis.prevDeals) / c.kpis.prevDeals) * 100) : null;
  const confColor = (x: string) => (x === "strong" ? C.green : x === "emerging" ? C.amber : C.faint);
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
            Weekly brief · {c.profile.name} · {c.window.start} → {c.window.end}
          </Text>
          {/* 2. Headline + KPI strip */}
          <Text style={S.h1}>{c.headline}</Text>
          <Section style={{ ...S.card, backgroundColor: C.bg }}>
            <Text style={S.p}>
              <strong>{c.kpis.deals}</strong> deals · <strong>{usd(c.kpis.capitalUsd)}</strong> raised ({c.kpis.pricedDeals} priced) · median <strong>{usd(c.kpis.medianUsd)}</strong>
            </Text>
            <Text style={S.small}>
              {wow === null ? "No previous window to compare" : `${wow >= 0 ? "▲" : "▼"} ${Math.abs(wow)}% deals vs previous window (${c.kpis.prevDeals})`} · Market temperature{" "}
              <strong>{c.kpis.temperature}/100</strong> (deal count z {c.kpis.temperatureComponents.deal_count?.z.toFixed(1)}, capital z {c.kpis.temperatureComponents.total_capital?.z.toFixed(1)})
            </Text>
          </Section>

          {/* 3. Watchlist hits */}
          {c.watchlistHits.length ? (
            <>
              <SectionTitle>🔴 Watchlist hits</SectionTitle>
              {c.watchlistHits.map((d) => (
                <DealBlock key={d.id} d={d} mode={mode} compact />
              ))}
            </>
          ) : null}

          {/* 4. Tracked-company adjacency (incl. cluster trigger) */}
          <AdjacencySection c={c} mode={mode} />

          {/* 5. TL;DR */}
          {c.tldr.length ? (
            <>
              <SectionTitle>TL;DR</SectionTitle>
              {c.tldr.map((t, i) => (
                <Text key={i} style={S.p}>
                  • {t}
                </Text>
              ))}
            </>
          ) : null}
          {c.narrative.length ? (
            <Section>
              {c.narrative.map((n, i) => (
                <Section key={i} style={{ margin: "10px 0" }}>
                  <Text style={S.p}>{n.claim}</Text>
                  <Text style={{ ...S.small, color: confColor(n.confidence) }}>
                    {n.confidence.replace("_", " ")} · {n.statBasis}
                  </Text>
                </Section>
              ))}
            </Section>
          ) : null}

          {/* 6. Patterns this week (incl. negative patterns) */}
          <SectionTitle>Patterns this week</SectionTitle>
          {c.patterns.length ? (
            c.patterns.map((p, i) => (
              <Section key={`${p.key}-${i}`} style={S.card}>
                <Text style={{ ...S.p, fontWeight: 600, margin: 0 }}>
                  {p.title}
                  {p.consecutiveWeeks > 1 ? ` · week ${p.consecutiveWeeks} in a row` : ""}
                </Text>
                <Text style={S.p}>{p.statement}</Text>
                <Text style={{ ...S.small, color: confColor(p.confidence) }}>
                  {p.confidence.replace("_", " ")} · n={p.sampleSize} · evidence:{" "}
                  {p.evidence.map((e, j) => (
                    <span key={e.id}>
                      {j ? ", " : ""}
                      {e.url ? (
                        <Link href={withUtm(e.url, mode)} style={S.link}>
                          {e.company}
                        </Link>
                      ) : (
                        e.company
                      )}
                    </span>
                  ))}
                </Text>
              </Section>
            ))
          ) : (
            <Text style={S.small}>No detector cleared its sample, effect and history gates this week.</Text>
          )}
          {c.suppressedDetectors.length ? (
            <Text style={{ ...S.small, color: C.faint }}>
              Suppressed for insufficient data: {c.suppressedDetectors.map((s) => `${s.key.replace(/_/g, " ")} (${s.reason})`).join("; ")}
            </Text>
          ) : null}

          {/* 7. Ranked deals */}
          <SectionTitle>Ranked deals</SectionTitle>
          {/* Capped so the email stays under Gmail's ~102 KB clipping limit (D-058). */}
          {[...c.ranked.act_now, ...c.ranked.high, ...c.ranked.relevant].slice(0, 12).map((d) => (
            <DealBlock key={d.id} d={d} mode={mode} compact={d.tier !== "act_now" && d.tier !== "high"} />
          ))}
          {c.ranked.act_now.length + c.ranked.high.length + c.ranked.relevant.length > 12 || c.ranked.contextCount ? (
            <Text style={S.small}>
              + {Math.max(0, c.ranked.act_now.length + c.ranked.high.length + c.ranked.relevant.length - 12) + c.ranked.contextCount} more deals on the{" "}
              <Link href={c.links.dashboard} style={S.link}>
                dashboard
              </Link>
              .
            </Text>
          ) : null}

          {/* 8. Serendipity */}
          {c.serendipity.length ? (
            <>
              <SectionTitle>Outside your mandate, worth knowing</SectionTitle>
              <Text style={S.small}>The most significant deals this week that did not match your mandate, so a perfect filter does not hide them.</Text>
              {c.serendipity.map((d) => (
                <DealBlock key={d.id} d={d} mode={mode} compact />
              ))}
            </>
          ) : null}

          {/* 9. Sector heat */}
          <SectionTitle>Sector heat</SectionTitle>
          {c.sectorHeat.map((s) => (
            <Text key={s.sector} style={{ ...S.p, fontWeight: s.mandate ? 600 : 400 }}>
              {s.mandate ? "★ " : ""}
              {s.sector}: {s.n} deals · {usd(s.capitalUsd)} · {s.wowDelta > 0 ? `▲${s.wowDelta}` : s.wowDelta < 0 ? `▼${-s.wowDelta}` : "–"} vs last window · {s.z >= 0 ? "+" : ""}
              {s.z.toFixed(1)}σ vs 8-wk
            </Text>
          ))}
          <Text style={S.small}>★ = core sector in your mandate</Text>

          {/* 10. Stage & cheque */}
          <SectionTitle>Stage &amp; cheque</SectionTitle>
          {c.stages.map((s) => (
            <Text key={s.stage} style={S.p}>
              {s.stage}: {s.n} deals · median {usd(s.medianUsd)} · {s.sharePct.toFixed(0)}% of capital (8-wk {s.baselineSharePct.toFixed(0)}%)
            </Text>
          ))}

          {/* 11. Investor activity */}
          <SectionTitle>Investor activity</SectionTitle>
          <Text style={S.p}>Most active: {c.investors.leaderboard.map((i) => `${i.investor} (${i.deals}${i.leadDeals ? `, led ${i.leadDeals}` : ""})`).join(", ") || "none"}</Text>
          {c.investors.inMandate.length ? <Text style={S.p}>Active in your sectors: {c.investors.inMandate.map((i) => `${i.investor} (${i.sectors.join("/")})`).join(", ")}</Text> : null}
          {c.investors.newEntrants.map((n, i) => (
            <Text key={i} style={S.p}>
              New entrant: {n.statement}
            </Text>
          ))}
          {c.investors.cadenceShifts.length ? (
            <Text style={S.p}>
              Faster than usual: {c.investors.cadenceShifts.map((x) => `${x.investor} ${x.deals} deals vs ${x.trailingWeeklyRate.toFixed(2)}/week`).join(", ")}
            </Text>
          ) : null}
          {c.investors.syndicates.length ? <Text style={S.p}>Repeat co-investors: {c.investors.syndicates.map((s) => `${s.a} + ${s.b} (${s.together}×, lift ${s.lift.toFixed(1)})`).join("; ")}</Text> : null}
          <Text style={S.small}>
            Follow-on participation: {c.investors.followOnShare.existing} of {c.investors.followOnShare.total} investor slots were existing investors.
          </Text>

          {/* 12–14. Events */}
          {c.fundCloses.length ? (
            <>
              <SectionTitle>New capital in the ecosystem</SectionTitle>
              {c.fundCloses.map((e) => (
                <EventLine key={e.id} e={e} mode={mode} />
              ))}
            </>
          ) : null}
          {c.exits.length ? (
            <>
              <SectionTitle>Exits &amp; consolidation</SectionTitle>
              {c.exits.map((e) => (
                <EventLine key={e.id} e={e} mode={mode} />
              ))}
            </>
          ) : null}
          {c.founders.length ? (
            <>
              <SectionTitle>Founders in motion</SectionTitle>
              {c.founders.map((e) => (
                <EventLine key={e.id} e={e} mode={mode} />
              ))}
            </>
          ) : null}

          {/* 15–16. LP talking points, open questions */}
          {c.lpTalkingPoints.length ? (
            <>
              <SectionTitle>LP talking points</SectionTitle>
              {c.lpTalkingPoints.map((t, i) => (
                <Text key={i} style={S.p}>
                  • {t}
                </Text>
              ))}
            </>
          ) : null}
          {c.openQuestions.length ? (
            <>
              <SectionTitle>Open questions</SectionTitle>
              {c.openQuestions.map((t, i) => (
                <Text key={i} style={S.p}>
                  • {t}
                </Text>
              ))}
            </>
          ) : null}

          {/* 17. Footer */}
          <Footer c={c} />
        </Container>
      </Body>
    </Html>
  );
}
