Output a single valid JSON object wrapped in a ```json code block. No prose before or after the block.

Schema:

```json
{
  "title": "PRD: [Feature / Initiative Name]",
  "status": "Draft",
  "problem_statement": "One paragraph. Who is affected, what is broken today, why solving it matters now.",
  "personas": [
    { "name": "Persona Name", "description": "One-line description", "goal": "What they want to achieve", "pain": "What stops them today" }
  ],
  "user_journeys": [
    {
      "id": "J1",
      "name": "Journey name",
      "steps": ["User does X", "System responds Y", "User does Z", "Outcome: what the user achieves"]
    }
  ],
  "success_metrics": {
    "primary": { "metric": "Metric name", "baseline": "Current value", "target": "Goal value", "timeframe": "e.g. 60 days post-launch", "measurement": "How measured" },
    "secondary": [
      { "metric": "Metric name", "baseline": "", "target": "", "timeframe": "", "measurement": "" }
    ]
  },
  "non_functional_requirements": [
    { "id": "NFR1", "category": "Performance|Scalability|Compliance|Availability", "requirement": "Specific measurable threshold", "priority": "Must|Should" }
  ],
  "functional_requirements": [
    { "id": "FR1", "requirement": "The system shall…" }
  ],
  "out_of_scope": [
    "What this version deliberately does not include"
  ],
  "open_questions": [
    { "id": 1, "type": "Question|Risk", "description": "Business scope, user behaviour, or priority trade-off only — not implementation or technical detail", "impact": "High|Med|Low", "owner": "Product|Business|Legal|Compliance|Design — never Engineering or Architecture", "status": "Open|Resolved", "answer": "Optional: human-provided answer when status is Resolved" }
  ]
}
```

Rules:
- success_metrics: `target` must be a concise threshold value only — e.g. "≥15% within 90 days; <12% triggers review". Do NOT include derivation rationale, benchmark citations, or supporting calculations. Those belong in the Research Brief, not in the metric itself.
- non_functional_requirements: 3 max — only the highest-priority thresholds that engineering absolutely must design to. Common candidates: a latency SLA, a data retention requirement, a scalability target.
- Aim for 10–20 functional requirements.
- open_questions: Up to 10, ranked by impact. **Business decisions only** — scope boundaries, expected user behaviour in ambiguous edge cases, priority trade-offs between conflicting requirements, unresolved compliance or policy constraints. Do NOT include implementation questions (which service owns X, which algorithm to use, how to handle a technical edge case) — those belong to the Solution Architect and Engineering stages. The `owner` must be a business stakeholder (Product, Business, Legal, Compliance, Design). If the owner would be Engineering or Architecture, the question is not a PRD question.
