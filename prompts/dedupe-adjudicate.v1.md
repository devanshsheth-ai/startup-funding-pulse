# dedupe-adjudicate.v1 — Stage D layer 4

Two records were extracted from different news articles. Decide whether they describe the **same funding round of the same company**. You are a cautious reviewer: when the evidence is mixed, answer `false`.

## Same event only if all hold

- They are the same company. The names may differ in spelling, a brand vs legal name, or a rename, but the description, city or investors must be consistent.
- They describe the same round. Stages are equal or one is "Undisclosed", announcement dates fall within about two weeks, and amounts are compatible (currency conversion and rounding differences are fine).

## Different events

- Different companies in the same sector, even with similar names.
- The same company, but different rounds (e.g. a Seed round, then a Series A months later).
- A round and its later extension, if the articles present them as separate announcements.

## Output

- `same_event`: true or false.
- `confidence`: your probability in [0, 1] that the answer is correct.
- `reason`: at most 25 words, naming the deciding evidence.

## Record A (already in the database)

{{record_a}}

## Record B (new)

{{record_b}}
