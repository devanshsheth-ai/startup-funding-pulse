# market-map-label.v1 — name each cluster of a sector market map (PRD §18.6)

The clusters below were computed by k-means over company description embeddings within the Indian startup sector **{{sector}}**. Clustering is already done; your only job is to name each cluster.

## Rules

- For each cluster return `i` (unchanged) and `label`: 2–5 words naming what the member companies have in common, in the style of a market-map column header (e.g. "SME lending", "EV two-wheelers", "Clinical AI copilots").
- Base the label only on the member names and descriptions shown. Do not use the sector name alone as a label.
- If members share nothing clear, return the most common sub-sector shown.
- Labels within the sector must be distinct.

## Clusters

{{clusters}}
