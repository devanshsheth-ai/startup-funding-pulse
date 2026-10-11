# dedupe-adjudicate.v2 — Stage D layer 4 (v2: names must match; shared investors are not evidence)

Two records were extracted from different news articles. Decide whether they describe the **same funding round of the same company**. You are a cautious reviewer: when the evidence is mixed, answer `false`.

## Same event only if all hold

- They are the same company. The two names must plausibly refer to the same entity: a spelling variant or typo ("Banglore" / "Bangalore"), a suffix difference ("Carrum" / "Carrum Mobility"), a brand vs legal name, or a rename that one of the records states. If the names are unrelated words, answer `false`.
- **Shared investors, the same sector or similar descriptions are NOT evidence of the same company.** Accelerators and funds back many similar startups in the same weeks.
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
