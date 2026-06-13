Output a single valid JSON object wrapped in a ```json code block. No prose before or after the block.

Schema:

```json
{
  "title": "GTM Strategy: [Feature / Initiative Name]",
  "positioning_statement": "For [segment] who [need], [product] is [category] that [benefit]. Unlike [alternative], [product] [differentiator].",
  "target_segments": [
    { "segment": "Segment name", "description": "Who they are", "priority": "High|Med|Low", "channels": ["channel1", "channel2"], "rationale": "Why this channel reaches this segment", "cost_to_reach": "Low|Med|High" }
  ],
  "messaging_framework": {
    "headline": "≤8 words",
    "sub_headline": "≤25 words — expands on headline, introduces key benefit",
    "supporting_bullets": [
      "Bold outcome word: supporting benefit (≤15 words)",
      "Bold outcome word: supporting benefit (≤15 words)",
      "Bold outcome word: supporting benefit (≤15 words)"
    ]
  },
  "launch_timeline": [
    { "phase": "Pre-launch", "duration": "e.g. 2 weeks before", "key_activities": ["Activity 1", "Activity 2"], "success_signal": "Measurable signal" },
    { "phase": "Launch Week", "duration": "Day 0–7", "key_activities": ["Activity 1"], "success_signal": "Measurable signal" },
    { "phase": "Post-Launch", "duration": "Week 2–8", "key_activities": ["Activity 1"], "success_signal": "Measurable signal" }
  ],
  "competitive_positioning": {
    "top_threat": "Primary alternative users will consider",
    "response_playbook": "2–3 sentences on how to respond when a prospect raises this competitor.",
    "we_win_when": [
      { "scenario": "Scenario description", "why_we_win": "Specific reason" }
    ],
    "we_lose_when": [
      { "scenario": "Scenario description", "why_we_lose": "Honest reason", "mitigation": "How sales/support handles it" }
    ]
  },
  "success_metrics": {
    "leading_indicators": [
      { "metric": "Metric name", "target": "Target value", "measurement": "How to measure" }
    ],
    "lagging_indicators": [
      { "metric": "Metric name", "target_30d": "Target", "target_60d": "Target", "target_90d": "Target", "measurement": "How to measure" }
    ]
  }
}
```

Rules:
- Do not propose budget figures.
- Do not redefine personas or success metrics from the PRD.
- Do not propose new features.
- Positioning statement must follow the Geoffrey Moore template exactly.
