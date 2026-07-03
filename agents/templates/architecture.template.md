Output a single valid JSON object wrapped in a ```json code block. No prose before or after the block.

Schema:

```json
{
  "title": "[Initiative Name] — Solution Architecture",
  "overview": "2–3 sentences: what is being built, platforms in scope, core architectural approach.",
  "approach": "1–2 sentences: how this fits the existing system — extending an existing pattern, adding a new service boundary, or integrating a new external API.",
  "key_decisions": [
    { "decision": "Decision area", "choice": "Chosen approach or technology" }
  ],
  "data_model": {
    "new_entities": [
      { "name": "Entity name", "purpose": "What it represents", "key_fields": "field1, field2, field3", "relationships": "FK to ExistingTable" }
    ],
    "entity_changes": [
      { "entity": "ExistingTableName", "change": "One-line summary of column or index added/removed" }
    ]
  },
  "new_dependencies": [
    {
      "name": "LibraryOrServiceName",
      "type": "npm-package | cloud-service | third-party-api | infrastructure",
      "not_solvable_with_existing_stack_because": "Specific reason the existing tech cannot do this"
    }
  ],
  "repository_impact": [
    { "repo": "repo-name", "changes_required": "One-line summary of what changes" }
  ],
  "open_questions": [
    { "decision": "Unresolved question — only when external input is genuinely required", "recommendation": "Architect's recommended resolution (1 sentence max)", "risk": "Risk if left unresolved (1 sentence max)", "owner": "Product|Business|Legal|Engineering-leads" }
  ]
}
```

Rules:
- **key_decisions**: 2–4 entries maximum. Only include choices that are irreversible or non-obvious from the existing tech stack. If the existing stack already covers it, do not list it.
- **data_model.new_entities**: List only net-new tables. Use an empty array `[]` if no new tables are needed.
- **data_model.entity_changes**: List only changes to existing tables. Use an empty array `[]` if no existing tables change.
- **new_dependencies**: List every technology that does NOT already appear in context/tech-stack.md. Use `[]` if all choices reuse the existing stack — this is a deliberate statement shown prominently to reviewers.
- **repository_impact**: For every repo in context/repos.md, include an entry. Use "No changes required" if unaffected.
- **open_questions**: Only raise a question when you genuinely cannot resolve it without external input — scale figures from Product, compliance obligations from Legal, retention periods from Business. If you can decide it, decide it here. Do NOT use open_questions as a deferred to-do list. API shapes, retry logic, error handling, and implementation details belong in story decomposition — never here.
- **API endpoints are out of scope.** Do not specify HTTP methods, paths, request/response shapes, or service contracts. Those belong in stories and implementation.
- **Infrastructure, deployment pipelines, cost estimates, and scalability projections are out of scope.**
- JSON validity: Never include literal newline characters in string fields. Use semicolons or em-dashes for multiple points within one field.
