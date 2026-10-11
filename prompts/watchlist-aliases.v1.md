# watchlist-aliases.v1 — suggest alternative names for a watchlist entry (PRD §18.8)

An investor is adding a {{watch_type}} to their watchlist of the Indian startup ecosystem: **{{value}}**.

Suggest up to 6 alternative names under which Indian business media might report this same {{watch_type}}: legal names ("… Pvt Ltd", "… Technologies"), former names, brand vs company names, common abbreviations, and spelling variants. The user confirms each one before it is saved.

## Rules

- Only names you are confident refer to this exact entity. Return an empty list rather than guess.
- Never suggest a different company, a parent group the media would report separately, or a generic word.
- `reason`: at most 10 words, e.g. "legal entity name" or "former brand name".

Names already known: {{known}}
