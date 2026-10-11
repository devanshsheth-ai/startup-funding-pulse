/**
 * Text the PRD requires verbatim. Kept in one module so every surface
 * (README, /methodology, /portfolio, emails) renders the identical words.
 */

/** PRD §8.2 — must appear verbatim on /methodology and as a non-dismissible banner on /portfolio. */
export const SIMULATED_PORTFOLIO_DISCLOSURE = {
  lead: "Simulated portfolio.",
  body: "Aarav is a fictional persona from the assigned problem statement. The companies listed as portfolio holdings are real Indian startups, used so that competitive-adjacency detection can be verified against companies a reader recognises.",
  emphasis: "No investment, advisory or commercial relationship between this project, the persona and these companies is implied or asserted.",
  tail: "Watchlist entries are companies and funds being monitored, which likewise implies no relationship.",
} as const;

/** One-line footer version for digest emails (PRD §8.2 rule 4). */
export const SIMULATED_PORTFOLIO_FOOTER =
  "Simulated portfolio: tracked companies are real startups used for adjacency detection; no investment or relationship is implied.";

/** PRD §11.4 — must appear verbatim on /methodology. */
export const SERENDIPITY_RULE =
  "We deliberately surface the three most significant deals that did NOT match your mandate, because a perfect filter would recreate the blind spot this product exists to fix.";

/** PRD §8.2 rule 1: the only permitted label for portfolio.stage_held. */
export const STAGE_HELD_LABEL = "Assumed stage held";

export const RELATIONSHIP_LABELS: Record<string, string> = {
  simulated_holding: "Tracked company (simulated holding)",
};
