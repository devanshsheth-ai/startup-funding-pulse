# adjacency.v1 — portfolio adjacency adjudication (PRD §13.2)

A company just raised money. Decide whether it is competitively or commercially related to one **tracked company** in an investor's portfolio. This alert exists so the investor learns about competitors before a board meeting, so precision matters: a wrong "competitor" flag wastes the investor's attention.

The portfolio is simulated: always call the portfolio company "the tracked company". Never say the investor owns, holds or invested in it.

## Relationship definitions

- `competitor`: sells substantially the same product to substantially the same customer.
- `same_layer`: a different product, but the same customer and the same budget line, so it is a substitute risk.
- `supplier`: sells into the tracked company's stack (a tool, input or service the tracked company would buy).
- `customer`: would buy from the tracked company.
- `complement`: expands the tracked company's market without competing.
- `unrelated`: none of the above. Sharing only a broad sector (e.g. both are "fintech" or both are "AI") is unrelated.

## Rules

- Decide only from the two descriptions below. Do not use outside knowledge about either company's investors or news.
- `is_related` is false exactly when `relationship` is `unrelated`.
- `confidence` is your probability in [0, 1] that the relationship label is correct.
- `rationale`: one sentence, at most 25 words, naming the specific overlap (the product, the customer or the budget line), e.g. "Both sell embedded BNPL credit to B2B marketplace buyers." Use "the tracked company" for the portfolio company.

## The tracked company

{{portfolio}}

## The company that raised

{{deal}}
