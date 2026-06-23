Output a single valid JSON object wrapped in a ```json code block. No prose before or after the block.

Schema:

```json
{
  "title": "Research Brief: [Initiative Name]",
  "executive_summary": "Exactly two paragraphs, separated by a literal blank line (\n\n) inside the string. Paragraph 1: market opportunity. Paragraph 2: top 2–3 findings the PM needs to act on. Inline refs like [1].",
  "problem_space": "1–3 short paragraphs. If more than one, separate each with a literal blank line (\n\n) inside the string. What problem are users experiencing today, what it costs them. Cite evidence with [N] refs.",
  "market_size": {
    "tam": "Total addressable market figure + source ref",
    "growth_cagr": "Growth rate + source ref",
    "key_driver": "Primary growth driver"
  },
  "target_users": [
    {
      "segment": "Segment name",
      "job_to_be_done": "What they are trying to accomplish",
      "current_workaround": "How they do it today",
      "key_frustration": "What breaks down"
    }
  ],
  "competitive_landscape": [
    { "player": "Competitor name", "strength": "What they do well", "gap": "Where they fall short" }
  ],
  "constraints_and_risks": [
    { "risk": "Risk description — 1–2 sentences, one idea only", "mitigation": "Brief mitigation — 1–2 sentences, one idea only" }
  ],
  "strategic_recommendations": [
    "Recommendation 1 with brief rationale — 1–2 sentences",
    "Recommendation 2 with brief rationale — 1–2 sentences",
    "Recommendation 3 with brief rationale — 1–2 sentences"
  ],
  "conclusion": "1–2 short paragraphs. If more than one, separate each with a literal blank line (\n\n) inside the string.",
  "references": [
    { "id": 1, "title": "Page title", "url": "URL returned by web search" }
  ]
}
```

Formatting rules:
- Wherever a field's description calls for more than one paragraph, separate the paragraphs with a literal blank line (two consecutive `\n` characters) inside the JSON string. Do not rely on sentence punctuation alone to imply a break — the renderer prints the string exactly as written, including the absence of breaks.
- Keep every `constraints_and_risks` and `strategic_recommendations` entry to 1–2 sentences covering one idea. Do not bundle multiple sub-topics into a single entry (e.g. a separate "Data source:", "Fallback:", "API contract:" inside one risk) — each renders as a single line, so packed entries become unreadable. If a risk genuinely has that much nuance, split it into separate entries instead.

Citation rules:
- Every factual claim must have an inline [N] immediately after it.
- Only include URLs that web search actually returned — never fabricate URLs.
- If no source exists for a claim, write "[Unverified]" instead of a number.
- Every inline [N] must appear in references; every references entry must be cited inline.
- If you have no web search tool available in this session, omit "references" entirely (use `[]`) and do not use [N] markers — see your system prompt's citation policy for this case.
