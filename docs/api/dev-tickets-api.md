# Dev/QA Ticket Export API

Read-only endpoints that let a developer agent, script, or CI job fetch everything
Product Hub generated for an initiative — without going through Azure DevOps (ADO).
ADO stays the system of record for ticket **state transitions**, **comments**, and
**history**; these endpoints ease the handoff of the **generated content itself**
(epic/feature/story descriptions, acceptance criteria, test cases) once it's been pushed.

All responses are plain cached reads — no live ADO calls happen on this path. Ticket
state (`New`/`Active`/`Done`/...) is whatever was last synced: either by the original
push or a later refresh from the Progress Tracker's "Refresh" button.

All endpoints share the same auth as every other `/api/*` route — a logged-in session
cookie when the instance has users configured, open access in single-user/no-auth mode.
There is no separate API key.

---

## Endpoints at a glance

| Endpoint | Purpose |
|----------|---------|
| `GET /api/dev/initiatives/:seqNum/manifest` | Initiative overview — epic context, feature phases, compact ticket list, topological implementation order. **Start here.** |
| `GET /api/dev/initiatives/:seqNum/tickets/payload` | Full ticket detail for a batch of local keys — call after loading the manifest. |
| `GET /api/dev/initiatives/:seqNum/tickets` | Full epic/feature/story tree, or QA test cases. Legacy single-call dump. |

The intended two-step workflow for a dev agent:

1. **`GET /manifest`** — load once to understand scope, phases, and dependency order.
2. **`GET /tickets/payload?ids=...`** — pull implementation batches (e.g. tickets with
   no unmet `dependsOn`, or all stories within a single feature/phase) and work through
   them incrementally.

---

## `GET /api/dev/initiatives/:seqNum/manifest`

Returns a compact initiative overview designed to give a dev agent the full picture
before starting implementation.

### Path parameter

| Param | Type | Description |
|-------|------|-------------|
| `seqNum` | integer | The `#<N>` display id shown on the initiative card (e.g. `#42` → `42`). |

### Response shape

```json
{
  "initiative": { "seqNum": 42, "id": "itm-...", "title": "Limit Up & Down Alerts" },
  "epic": {
    "localKey": "epic",
    "adoId": 10234,
    "adoUrl": "https://dev.azure.com/.../_workitems/edit/10234",
    "title": "Limit Up & Down Alerts",
    "description": "Traders need real-time notifications when a security hits a user-defined price limit.",
    "businessValue": "Reduces support tickets, increases active trader retention.",
    "state": "Active",
    "stateBucket": "in_progress"
  },
  "features": [
    {
      "localKey": "F0",
      "adoId": 10235,
      "adoUrl": "https://dev.azure.com/.../_workitems/edit/10235",
      "title": "Alert Configuration",
      "description": "UI and API for creating, editing, and deleting price alerts.",
      "phase": "Phase 1 — Core",
      "storyCount": 4,
      "totalPoints": 11,
      "state": "New",
      "stateBucket": "not_started"
    }
  ],
  "tickets": [
    {
      "localKey": "F0.S0",
      "adoId": 10236,
      "adoUrl": "https://dev.azure.com/.../_workitems/edit/10236",
      "title": "Create alert threshold endpoint",
      "featureLocalKey": "F0",
      "featureTitle": "Alert Configuration",
      "phase": "Phase 1 — Core",
      "estimatedPoints": 3,
      "platform": ["backend"],
      "dependsOn": [],
      "state": "New",
      "stateBucket": "not_started"
    },
    {
      "localKey": "F0.S1",
      "adoId": 10237,
      "adoUrl": "https://dev.azure.com/.../_workitems/edit/10237",
      "title": "Alert configuration UI",
      "featureLocalKey": "F0",
      "featureTitle": "Alert Configuration",
      "phase": "Phase 1 — Core",
      "estimatedPoints": 5,
      "platform": ["web"],
      "dependsOn": ["F0.S0"],
      "state": "New",
      "stateBucket": "not_started"
    }
  ],
  "implementationOrder": ["F0.S0", "F0.S2", "F0.S1", "F0.S3", "F1.S0", "F1.S1"]
}
```

Notes:
- `tickets` is a **compact** list — no AC, technical notes, or agent context. Use
  `/tickets/payload` to load full detail for a batch.
- `dependsOn` entries are **local keys** (e.g. `F0.S0`), resolved from the LLM-generated
  `story_id` references in the backlog artifact. Pass-through of unresolvable refs is
  possible if the artifact uses IDs that don't map to a known story.
- `implementationOrder` is a topologically sorted array of `localKey` values — tickets
  with no unmet dependencies appear first. Cycles or unknown refs are handled gracefully:
  unresolvable nodes append at the end.
- `totalPoints` in each feature sums `estimated_points` (new format) or `effort`
  (old format) across that feature's stories.
- `epic` is `null` if no epic row was pushed for this initiative.

### Errors

| Status | When |
|--------|------|
| 400 | `seqNum` is not a positive integer |
| 404 | No initiative with that `seqNum`, it's archived, or no tickets have been pushed yet |
| 500 | Unexpected server error |

---

## `GET /api/dev/initiatives/:seqNum/tickets/payload`

Returns full story content for a requested batch of local keys. Intended to be called
after loading the manifest, once the agent has decided which tickets to work on next.

### Path parameter

| Param | Type | Description |
|-------|------|-------------|
| `seqNum` | integer | The `#<N>` display id shown on the initiative card. |

### Query parameters

| Param | Required | Description |
|-------|----------|-------------|
| `ids` | yes | Comma-separated local keys to fetch (e.g. `F0.S0,F0.S1,F1.S3`). May also be repeated (`?ids=F0.S0&ids=F0.S1`). |

### Example

```bash
# Pull the first batch — tickets with no dependencies
curl "http://localhost:3001/api/dev/initiatives/42/tickets/payload?ids=F0.S0,F0.S2,F1.S0"

# Pull the next batch after completing the first
curl "http://localhost:3001/api/dev/initiatives/42/tickets/payload?ids=F0.S1,F0.S3,F1.S1"
```

### Response shape

```json
{
  "initiative": { "seqNum": 42, "id": "itm-...", "title": "Limit Up & Down Alerts" },
  "tickets": [
    {
      "localKey": "F0.S0",
      "adoId": 10236,
      "adoUrl": "https://dev.azure.com/.../_workitems/edit/10236",
      "state": "New",
      "stateBucket": "not_started",
      "featureLocalKey": "F0",
      "featureTitle": "Alert Configuration",
      "phase": "Phase 1 — Core",
      "title": "Create alert threshold endpoint",
      "storyId": "alert-threshold-api",
      "persona": "active trader",
      "goal": "set a custom alert threshold via API",
      "benefit": "I can automate alert management from my own tooling",
      "acceptanceCriteria": [
        "Given a valid auth token When I POST /alerts with a threshold value Then the alert is persisted and a 201 is returned"
      ],
      "technicalAcceptanceCriteria": [
        "Threshold value must be validated as a positive number with up to 4 decimal places"
      ],
      "agentContext": "This is the foundational API endpoint — all other alert stories depend on it.",
      "estimatedPoints": 3,
      "estimatedHours": 6,
      "platform": ["backend"],
      "dependsOn": [],
      "technicalNotes": { "backend": "Use existing price-validation middleware." }
    }
  ],
  "notFound": ["F9.S99"]
}
```

Notes:
- `notFound` is omitted from the response when all requested keys were found.
- Story content fields are normalised from both artifact formats:
  - New format: `as_a`/`i_want`/`so_that`, `acceptance_criteria`,
    `technical_acceptance_criteria`, `estimated_points`, `platform`, `story_id`
  - Old format: `persona`/`goal`/`benefit`, `acceptanceCriteria`, `technical_notes`,
    `effort`, `estimatedHours`
  - The payload endpoint always maps to the unified field names above regardless of
    which format the underlying artifact uses.
- `dependsOn` entries are local keys (same resolution as the manifest).
- Requesting a key for a non-story work item type (e.g. `epic` or `F0`) returns nothing
  for that key — it appears in `notFound`.

### Errors

| Status | When |
|--------|------|
| 400 | `seqNum` is not a positive integer, or `ids` is missing |
| 404 | No initiative with that `seqNum` or it's archived |
| 500 | Unexpected server error |

---

## `GET /api/dev/initiatives/:seqNum/tickets`

Full epic/feature/story tree (default) or QA test cases (`mode=qa`). Returns everything
in a single response — no batching. Use the manifest + payload pair for large initiatives
where context-window management matters.

### Path parameter

| Param | Type | Description |
|-------|------|-------------|
| `seqNum` | integer | The `#<N>` display id shown on the initiative card. |

### Query parameters

| Param | Values | Default | Description |
|-------|--------|---------|-------------|
| `mode` | `dev` \| `qa` | `dev` | `dev` returns the full epic/feature/story content. `qa` returns test cases only. The two are mutually exclusive — pick one per call. |
| `stream` | one or more of `backend`, `web`, `ios`, `android` | *(all)* | Filters which tickets/test cases come back. Accepts comma-separated (`?stream=backend,ios`) and/or repeated params. Tickets with no resolvable platform tag are always included. |

### Examples

```bash
# Full ticket content for initiative #42
curl http://localhost:3001/api/dev/initiatives/42/tickets

# Backend-only tickets
curl "http://localhost:3001/api/dev/initiatives/42/tickets?stream=backend"

# iOS + Android test cases only
curl "http://localhost:3001/api/dev/initiatives/42/tickets?mode=qa&stream=ios,android"
```

### Response shape — `mode=dev` (default)

```json
{
  "initiative": { "seqNum": 42, "id": "itm-...", "title": "Limit Up & Down Alerts" },
  "mode": "dev",
  "stream": null,
  "epics": [
    {
      "localKey": "epic",
      "adoId": 10234,
      "adoUrl": "https://dev.azure.com/.../_workitems/edit/10234",
      "title": "Limit Up & Down Alerts",
      "state": "Active",
      "stateBucket": "in_progress",
      "description": "...",
      "businessValue": "..."
    }
  ],
  "features": [
    {
      "localKey": "F0",
      "adoId": 10235,
      "adoUrl": "https://dev.azure.com/.../_workitems/edit/10235",
      "title": "Alert Configuration",
      "state": "New",
      "stateBucket": "not_started",
      "description": "...",
      "phase": "Phase 1 — Core",
      "stories": [
        {
          "localKey": "F0.S0",
          "adoId": 10236,
          "adoUrl": "https://dev.azure.com/.../_workitems/edit/10236",
          "title": "Create alert threshold endpoint",
          "state": "New",
          "stateBucket": "not_started",
          "story_id": "alert-threshold-api",
          "as_a": "active trader",
          "i_want": "to set a custom alert threshold",
          "so_that": "I'm notified before a limit is hit",
          "acceptance_criteria": ["..."],
          "technical_acceptance_criteria": ["..."],
          "platform": ["backend"],
          "estimated_points": 3
        }
      ]
    }
  ]
}
```

Notes:
- `epics`/`features`/`stories` carry both live ADO tracking fields and raw generated
  content passed through as-is from the artifact. `title` always comes from ADO.
- Story content fields vary by pipeline generation format — older stories use
  `persona`/`goal`/`benefit`/`acceptanceCriteria`/`technical_notes`/`effort`; newer
  stories use `as_a`/`i_want`/`so_that`/`acceptance_criteria`/`platform`/`estimated_points`.
  Both shapes may appear across stories in the same initiative. The `/tickets/payload`
  endpoint normalises these into a single consistent shape.
- A feature that had stories but lost every one of them to a `stream` filter is omitted
  entirely rather than returned with an empty `stories` array.

### Response shape — `mode=qa`

```json
{
  "initiative": { "seqNum": 42, "id": "itm-...", "title": "Limit Up & Down Alerts" },
  "mode": "qa",
  "stream": ["ios", "android"],
  "testCases": [
    {
      "id": "TC-001",
      "title": "Alert fires when threshold is crossed",
      "type": "happy_path",
      "priority": "high",
      "story_ref": "F0.S0",
      "steps": ["..."],
      "expectedResult": "..."
    }
  ],
  "testPlans": [
    { "planId": 555, "planUrl": "https://dev.azure.com/.../_testPlans/555", "testCaseCount": 18 }
  ]
}
```

`stream` filtering in `qa` mode works by resolving each test case's `story_ref` back to
the story it covers (and that story's platform tags) — a test case whose `story_ref`
can't be resolved is always included rather than dropped.

### Errors

| Status | When |
|--------|------|
| 400 | `seqNum` isn't a positive integer, `mode` isn't `dev`/`qa`, or `stream` contains an unknown value |
| 404 | No initiative has that `seqNum`, it's archived, or it has never been pushed to Azure DevOps |
| 500 | Unexpected server error |

---

## Implementation

`app/backend/src/routes/dev-tickets-routes.ts`, mounted at `/api/dev/initiatives`
in `server.ts`. Backlog/QA-artifact parsing and platform filtering live in
`@pap/shared` (`backlog-helpers.ts`, `qa-test-helpers.ts`) so this route, the
Progress Tracker detail page, and the live artifact viewer all interpret the same
artifact JSON the same way.
