# Stage-Specific Checks: Research Brief (Sage)

Structural validation (citation counts, references section, suspicious URLs, assumption markers) has already been performed by automated tools before this review. Do not re-raise those structural issues.

## Insight quality

- Research must directly and specifically address the goal stated in the brief. Content about adjacent topics that does not inform the stated goal is **MINOR** if one section, **MAJOR** if it dominates the document.
- Analysis must go beyond surface-level facts. A brief that only restates commonly known information without synthesising implications for the stated initiative is **MAJOR** — it adds no signal the PM could not have found independently.
- Risks and opportunities must be specific to the domain, market, and user segment in the brief. Generic risks ("market may be competitive", "regulatory environment may change") with no domain-specific grounding are **MAJOR**.

## Coverage

- If the brief named a specific geography, user segment, or market, the research must address it directly. Coverage of a proxy market with no explicit mapping is **MAJOR**.
- Strategic implications must be actionable — the PM must be able to use them to make a scoping decision. Implications that are purely observational ("the market is growing") with no recommended direction are **MINOR** individually, **MAJOR** if the entire implications section lacks direction.

## Unverified claims

- Claims marked `[Assumption — no source found]` (web search available) or `[Unverified — recommend manual confirmation]` (no web search available) are expected and correct behaviour. Do not flag them as defects.
- This check applies only when web search was available for this document (see the no-web-search note above, if present). If web search was NOT available, the majority — or all — of substantive claims being unverified/inferred is expected and must not be flagged, regardless of proportion.
- If web search WAS available and the brief's conclusions still rest almost entirely on unverified assumptions (the majority of substantive claims are assumptions) despite the analyst having tools to verify them, flag as **MAJOR** — the analysis lacks an evidential foundation.

## PM Questions

Should only cover methodology scope — geography, user segments, depth requested. Not data provenance or citation accuracy.
