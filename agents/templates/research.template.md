Output a single valid JSON object wrapped in a ```json code block. No prose before or after the block.

Schema:

```json
{
  "title": "Research Brief: [Initiative Name]",
  "executive_summary": "Two paragraphs. Paragraph 1: market opportunity. Paragraph 2: top 2–3 findings the PM needs to act on. Inline refs like [1].",
  "problem_space": "What problem are users experiencing today, what it costs them. Cite evidence with [N] refs.",
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
    { "risk": "Risk description", "mitigation": "Brief mitigation" }
  ],
  "strategic_recommendations": [
    "Recommendation 1 with brief rationale",
    "Recommendation 2 with brief rationale",
    "Recommendation 3 with brief rationale"
  ],
  "conclusion": "Concluding statements based on findings.",
  "references": [
    { "id": 1, "title": "Page title", "url": "URL returned by web search" }
  ]
}
```

Citation rules:
- Every factual claim must have an inline [N] immediately after it.
- Only include URLs that web search actually returned — never fabricate URLs.
- If no source exists for a claim, write "[Unverified]" instead of a number.
- Every inline [N] must appear in references; every references entry must be cited inline.
- If you have no web search tool available in this session, omit "references" entirely (use `[]`) and do not use [N] markers — see your system prompt's citation policy for this case.
