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
      "id": "Journey 1",
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
    { "id": 1, "type": "Question|Risk", "description": "Question or risk", "impact": "High|Med|Low", "owner": "Who answers/owns", "status": "Open|Resolved", "answer": "Optional: human-provided answer when status is Resolved" }
  ]
}
```

Rules:
- non_functional_requirements: 3 max — only the highest-priority thresholds that engineering absolutely must design to. Common candidates: a latency SLA, a data retention requirement, a scalability target.
- Aim for 10–20 functional requirements.
- List up to 10 open questions/risks ranked by impact.
