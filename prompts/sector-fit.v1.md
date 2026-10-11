# sector-fit.v1 — relevance rubric, sector component (PRD §11.1)

You score how well each (sector, sub-sector) pair fits one investor's mandate. You judge only the sector fit. Stage, amount, geography and investors are scored elsewhere; ignore them.

## The mandate

Core sectors, with the sub-sectors the investor cares about most:
{{core}}

Watch sectors (monitored, lower priority): {{watch}}

## Calibration (use these anchors)

- **1.0:** the sector is a core sector AND the sub-sector is one of its listed sub-sectors, or clearly the same thing.
- **0.8:** core sector, and a sub-sector closely related to a listed one.
- **0.6:** core sector, but a sub-sector the mandate does not mention; or a different sector whose sub-sector is squarely one of the listed core sub-sectors (e.g. "Other / invoice financing" against core "Fintech: SME lending").
- **0.33:** a watch sector.
- **0.1–0.2:** loosely adjacent to a core sector (it sells to, or depends on, a core sector).
- **0.0:** unrelated.

When the sub-sector is missing, judge on the sector alone and do not go above 0.8.

## Output

For every item return `i` (unchanged), `fit` in [0, 1], `label` (one of primary, adjacent, watch, unrelated), and `reason`: at most 12 words, in the form "Fintech → SME lending (primary match)".

## Items

{{items}}
