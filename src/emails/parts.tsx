import { Hr, Link, Section, Text } from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";
import type { DealCard, DigestContent, DigestMode, EventItem } from "@/pipeline/digest";
import { withUtm } from "@/pipeline/digest";

/** Shared building blocks for the digest emails. Inline styles only (email clients). */

export const C = {
  ink: "#111827",
  muted: "#4b5563",
  faint: "#6b7280",
  line: "#e5e7eb",
  red: "#b91c1c",
  amber: "#b45309",
  blue: "#1d4ed8",
  green: "#047857",
  bg: "#f9fafb",
};

export const S: Record<string, CSSProperties> = {
  body: { backgroundColor: "#ffffff", fontFamily: "-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif", color: C.ink, margin: 0 },
  container: { maxWidth: "600px", margin: "0 auto", padding: "16px" },
  h1: { fontSize: "22px", lineHeight: "28px", fontWeight: 700, margin: "8px 0" },
  h2: { fontSize: "17px", lineHeight: "24px", fontWeight: 700, margin: "24px 0 8px" },
  p: { fontSize: "15px", lineHeight: "23px", margin: "6px 0" },
  small: { fontSize: "13px", lineHeight: "19px", color: C.muted, margin: "4px 0" },
  card: { border: `1px solid ${C.line}`, borderRadius: "8px", padding: "12px", margin: "8px 0" },
  alert: { borderLeft: `4px solid ${C.red}`, backgroundColor: "#fef2f2", borderRadius: "6px", padding: "10px 12px", margin: "8px 0" },
  link: { color: C.blue, textDecoration: "underline" },
};

export const usd = (n: number | null | undefined): string =>
  n === null || n === undefined ? "undisclosed" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`;

const TIER_LABEL: Record<string, string> = { act_now: "🔴 Act now", high: "🟠 High", relevant: "🟡 Relevant", context: "⚪ Context", archive: "Archive" };
const REL_LABEL: Record<string, string> = { competitor: "🔴 Competitor", same_layer: "🟠 Same layer", supplier: "🔵 Supplier", customer: "🔵 Customer", complement: "🔵 Complement" };

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={S.h2}>{children}</Text>;
}

export function Badges({ d }: { d: DealCard }) {
  const parts: string[] = [];
  if (d.disputed.length) parts.push(`✗ disputed: ${d.disputed.join(", ")}`);
  else if (d.corroboration >= 2) parts.push(`✓ corroborated (${d.corroboration} sources)`);
  else parts.push("⚠ single source");
  return <Text style={S.small}>{parts.join(" · ")}</Text>;
}

/** Deal card with provenance: company links to the primary (earliest) source. */
export function DealBlock({ d, mode, compact = false, showScore = true }: { d: DealCard; mode: DigestMode | "alert"; compact?: boolean; showScore?: boolean }) {
  const primary = d.sources.find((s) => s.isPrimary) ?? d.sources[0];
  const comps = d.breakdown?.components;
  return (
    <Section style={S.card}>
      <Text style={{ ...S.p, fontWeight: 600, margin: 0 }}>
        {primary ? (
          <Link href={withUtm(primary.url, mode)} style={S.link}>
            {d.company}
          </Link>
        ) : (
          d.company
        )}{" "}
        · {d.stage} · {usd(d.amountUsd)} · {d.sector}
        {d.city ? ` · ${d.city}` : ""}
      </Text>
      {showScore ? (
        <Text style={S.small}>
          {TIER_LABEL[d.tier] ?? d.tier} {d.score} — {d.reason}
        </Text>
      ) : null}
      {d.leads.length || d.participants.length ? (
        <Text style={S.small}>
          {d.leads.length ? `Lead: ${d.leads.join(", ")}` : "Lead: not reported"}
          {d.participants.length ? ` · Also: ${d.participants.slice(0, 4).join(", ")}${d.participants.length > 4 ? "…" : ""}` : ""}
        </Text>
      ) : null}
      {!compact && comps ? (
        <Text style={{ ...S.small, color: C.faint }}>
          Scorecard: sector {comps.sector_fit.points}/{comps.sector_fit.max} · stage {comps.stage_fit.points}/{comps.stage_fit.max} · cheque {comps.cheque_fit.points}/{comps.cheque_fit.max} ·
          investor {comps.tracked_investor.points}/{comps.tracked_investor.max} · geo {comps.geography_fit.points}/{comps.geography_fit.max} · recency {comps.recency.points}/{comps.recency.max} ·
          significance {comps.ecosystem_significance.points}/{comps.ecosystem_significance.max}
          {d.breakdown?.overrides.length ? ` · overrides ${d.breakdown.overrides.map((o) => `+${o.points}`).join(" ")}` : ""}
          {d.breakdown && d.breakdown.confidence_multiplier !== 1 ? ` · ×${d.breakdown.confidence_multiplier} single-source` : ""}
        </Text>
      ) : null}
      <Text style={S.small}>
        Reported by {d.sources.length} source{d.sources.length === 1 ? "" : "s"}{d.sources.length > 3 ? " (first 3)" : ""}:{" "}
        {d.sources.slice(0, 3).map((s, i) => (
          <span key={`${d.id}-${i}`}>
            {i ? " · " : ""}
            <Link href={withUtm(s.url, mode)} style={S.link}>
              {s.publication}
            </Link>
            {s.isPrimary ? " (first)" : ""}
          </span>
        ))}
      </Text>
      <Badges d={d} />
    </Section>
  );
}

export function EventLine({ e, mode }: { e: EventItem; mode: DigestMode }) {
  const src = e.sources.find((s) => s.isPrimary) ?? e.sources[0];
  return (
    <Text style={S.p}>
      •{" "}
      {src ? (
        <Link href={withUtm(src.url, mode)} style={S.link}>
          {e.headline}
        </Link>
      ) : (
        e.headline
      )}
      <span style={{ color: C.faint, fontSize: "13px" }}>
        {" "}
        ({e.date}
        {e.fundSizeUsd ? ` · fund ${usd(e.fundSizeUsd)}` : e.amountUsd ? ` · ${usd(e.amountUsd)}` : ""}
        {e.mandateOverlap.length ? ` · overlaps your mandate: ${e.mandateOverlap.slice(0, 3).join(", ")}` : ""})
      </span>
    </Text>
  );
}

/** One card per deal, listing every tracked company it relates to (strongest first). */
export function groupAdjacency(items: DigestContent["adjacency"]): { deal: DealCard; links: DigestContent["adjacency"] }[] {
  const order = ["competitor", "same_layer", "supplier", "customer", "complement"];
  const groups = new Map<string, { deal: DealCard; links: DigestContent["adjacency"] }>();
  for (const a of items) {
    const g = groups.get(a.deal.id) ?? { deal: a.deal, links: [] };
    g.links.push(a);
    groups.set(a.deal.id, g);
  }
  const rank = (g: { links: DigestContent["adjacency"] }) => Math.min(...g.links.map((l) => order.indexOf(l.relationship)));
  return [...groups.values()]
    .map((g) => ({ ...g, links: g.links.sort((x, y) => order.indexOf(x.relationship) - order.indexOf(y.relationship)) }))
    .sort((a, b) => rank(a) - rank(b) || b.deal.score - a.deal.score);
}

export function AdjacencySection({ c, mode }: { c: DigestContent; mode: DigestMode }) {
  if (!c.adjacency.length && !c.clusters.length) return null;
  return (
    <>
      <SectionTitle>🔴 Tracked-company adjacency alerts</SectionTitle>
      {c.clusters.map((cl) => (
        <Section key={cl.portfolio} style={S.alert}>
          <Text style={{ ...S.p, fontWeight: 700, margin: 0 }}>
            {cl.deals.length} companies adjacent to {cl.portfolio} (tracked company) have raised in the last {cl.windowDays} days:
          </Text>
          <Text style={S.p}>
            {cl.deals.map((d, i) => (
              <span key={d.id}>
                {i ? ", " : ""}
                {d.url ? (
                  <Link href={withUtm(d.url, mode)} style={S.link}>
                    {d.company}
                  </Link>
                ) : (
                  d.company
                )}{" "}
                ({d.relationship.replace("_", " ")}, {d.announced})
              </span>
            ))}
          </Text>
        </Section>
      ))}
      {groupAdjacency(c.adjacency)
        .slice(0, 6)
        .map((g) => (
          <Section key={g.deal.id}>
            {g.links.map((a) => (
              <Text key={a.portfolio} style={{ ...S.small, fontWeight: 600, color: a.relationship === "competitor" ? C.red : a.relationship === "same_layer" ? C.amber : C.blue }}>
                {REL_LABEL[a.relationship] ?? a.relationship} to {a.portfolio} (tracked company) — {a.rationale}
              </Text>
            ))}
            <DealBlock d={g.deal} mode={mode} compact />
          </Section>
        ))}
    </>
  );
}

/** Alerts held back (daily cap, cooldown, delivery rule) and folded into the digest. */
export function HeldAlerts({ c }: { c: DigestContent }) {
  const held = c.heldAlerts ?? [];
  if (held.length === 0) return null;
  return (
    <>
      <SectionTitle>Alerts held for this brief</SectionTitle>
      {held.map((h) => (
        <Text key={h.id} style={S.small}>
          <strong>{h.title}</strong> — {h.body}
        </Text>
      ))}
    </>
  );
}

export function Footer({ c }: { c: DigestContent }) {
  return (
    <>
      <Hr style={{ borderColor: C.line, margin: "24px 0 12px" }} />
      <Text style={S.small}>
        <Link href={c.links.dashboard} style={S.link}>
          Dashboard
        </Link>{" "}
        ·{" "}
        <Link href={c.links.methodology} style={S.link}>
          How deals are ranked
        </Link>{" "}
        ·{" "}
        <Link href={c.links.settings} style={S.link}>
          Settings
        </Link>{" "}
        ·{" "}
        <Link href={c.links.health} style={S.link}>
          Data health
        </Link>
        {c.links.share ? (
          <>
            {" "}
            ·{" "}
            <Link href={c.links.share} style={S.link}>
              Shareable link
            </Link>
          </>
        ) : null}
      </Text>
      <Text style={S.small}>
        Window {c.window.start} → {c.window.end} · {c.counts.aggregatesN} deals in window · generated {c.generatedAt.slice(0, 16).replace("T", " ")} UTC
        {c.narrationStatus === "degraded" ? " · narrative unavailable this run; figures are complete" : ""}
      </Text>
      <Text style={{ ...S.small, color: C.faint }}>{c.disclosure}</Text>
    </>
  );
}
