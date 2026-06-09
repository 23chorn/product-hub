Produce a single valid JSON object wrapped in a ```json code block. This is a technically refined version of the PM backlog — same structure, enriched technical content. No prose before or after the JSON block.

Use the **same tier structure** as the PM backlog input:

**Tier 3 — Epic with features** (most common for tech refinement):
```json
{
  "epic": {
    "title": "Short epic name",
    "description": "One sentence: what capability this epic delivers",
    "businessValue": "Why this matters to the business",
    "prdLink": "Initiative name or URL",
    "definitionOfDone": "Engineering definition of done for the full epic"
  },
  "features": [
    {
      "title": "Feature name",
      "description": "What user capability this feature unlocks",
      "phase": "MVP | Phase 2 | Post-launch",
      "stories": [
        {
          "title": "Story title",
          "persona": "Which persona from the PRD",
          "goal": "what the persona wants to achieve — from the user's point of view",
          "benefit": "so that [outcome for the persona]",
          "acceptanceCriteria": [
            "Given [context] When [action] Then [result]"
          ],
          "prdRef": {
            "functionalRequirements": ["FR-01"],
            "userJourney": "Journey · Step"
          },
          "platform": "ios | android | backend | all | ios+android | ios+backend | android+backend",
          "technical": {
            "constraints": ["Specific constraint, e.g. 'Requires iOS 16+ for SwiftUI NavigationStack'"],
            "affectedComponents": ["Specific component names, e.g. 'MessageListViewController', 'ChatRepository', 'POST /api/rooms/:id/messages'"],
            "dataChanges": "Specific DB/model changes, e.g. 'Add messages table: id UUID PK, room_id FK, sender_id FK, body TEXT, created_at TIMESTAMP' or null",
            "apiChanges": "Specific API changes, e.g. 'POST /api/rooms/:id/messages { body: string } → 201 { message: MessageDTO }' or null"
          },
          "risks": [
            {
              "risk": "Specific technical risk description",
              "severity": "high | medium | low",
              "mitigation": "Specific mitigation approach"
            }
          ],
          "effort": 3
        }
      ]
    }
  ]
}
```

**Tier 2 — Single feature** (when the scope is a single capability):
```json
{
  "feature": {
    "title": "Feature name",
    "description": "What user capability this feature unlocks",
    "phase": "MVP | Phase 2 | Post-launch",
    "stories": [ { ...story fields as above... } ]
  }
}
```

**Tier 1 — Single story** (trivial scope):
```json
{
  "story": { ...story fields as above... }
}
```

Rules:
- `platform` is required on every story. Use `"all"` only when the story is genuinely cross-cutting (e.g., a shared model change that has no platform-specific code). Use compound values like `"ios+android"` when the story requires platform work but no backend change.
- `technical.affectedComponents` must name specific files, classes, endpoints, or services — not categories like "API layer" or "database".
- `technical.dataChanges` must include the table name and columns with types when a DB change is needed. Use `null` if no DB change.
- `technical.apiChanges` must include method, path, request shape, and response shape. Use `null` if no API change.
- `risks` may be an empty array `[]` if no risks exist. Do not omit the field.
- Stories must be in dependency order within each feature. Backend/infra stories before frontend/consumer stories.
- Effort scores are Fibonacci (1, 2, 3, 5, 8). Stories above 8 must be split before appearing in this output.
- You may add new engineering stories (infra setup, DB migrations, platform entitlements) that the PM backlog omitted. Mark these with `"persona": "Engineering"` and `"goal": "set up [X] so that feature development can proceed"`.
- Maximum 6 features per epic, maximum 12 stories per feature.
