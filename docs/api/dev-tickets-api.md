# Dev/QA Ticket Export API

A read-only endpoint that lets a developer, QA engineer, script, or CI job fetch
everything Product Hub generated for an initiative — without going through Azure
DevOps (ADO). ADO stays the system of record for ticket **state transitions**,
**comments**, and **history**; this endpoint just eases the handoff of the
**generated content itself** (epic/feature/story descriptions, acceptance
criteria, test cases) once it's been pushed.

It's a plain cached read: no live ADO calls happen on this path. Ticket state
(`New`/`Active`/`Done`/...) is whatever was last synced — either by the original
push or a later refresh from the Progress Tracker's "Refresh" button.

## Endpoint

```
GET /api/dev/initiatives/:seqNum/tickets
```

Same auth as every other `/api/*` route in this app — a logged-in session cookie
when the instance has users configured, open access in single-user/no-auth mode.
There is no separate API key.

### Path parameter (required)

| Param | Type | Description |
|-------|------|--------------|
| `seqNum` | integer | The initiative's display id — the `#<N>` badge shown on its card on the Home screen (e.g. `#42` → `42`). This is the **only** required parameter. |

### Query parameters (optional)

| Param | Values | Default | Description |
|-------|--------|---------|--------------|
| `mode` | `dev` \| `qa` | `dev` | `dev` returns the full epic/feature/story content. `qa` returns test cases only (no epic/feature/story tree). The two are mutually exclusive — pick one per call. |
| `stream` | one or more of `backend`, `web`, `ios`, `android` | *(all streams)* | Filters which tickets/test cases come back. Accepts a comma-separated list (`?stream=backend,ios`) and/or repeated params (`?stream=backend&stream=ios`). Tickets with no resolvable platform tag are always included — the filter narrows out *confirmed* non-matches, it never hides content it can't classify. |

## Examples

Full ticket content for initiative #42:
```bash
curl http://localhost:3001/api/dev/initiatives/42/tickets
```

Backend-only tickets:
```bash
curl "http://localhost:3001/api/dev/initiatives/42/tickets?stream=backend"
```

iOS + Android test cases only:
```bash
curl "http://localhost:3001/api/dev/initiatives/42/tickets?mode=qa&stream=ios,android"
```

## Response shape — `mode=dev` (default)

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
      "localKey": "F1",
      "adoId": 10235,
      "adoUrl": "https://dev.azure.com/.../_workitems/edit/10235",
      "title": "[F1] Alert Configuration",
      "state": "New",
      "stateBucket": "not_started",
      "description": "...",
      "phase": "MVP",
      "stories": [
        {
          "localKey": "F1.S1",
          "adoId": 10236,
          "adoUrl": "https://dev.azure.com/.../_workitems/edit/10236",
          "title": "[F1.S1] Configure alert threshold",
          "state": "New",
          "stateBucket": "not_started",
          "story_id": "F1.S1",
          "as_a": "active trader",
          "i_want": "to set a custom alert threshold",
          "so_that": "I'm notified before a limit is hit",
          "acceptance_criteria": ["..."],
          "technical_acceptance_criteria": ["..."],
          "platform": ["backend", "web"],
          "estimated_points": 3
        }
      ]
    }
  ]
}
```

Notes:
- `epics`/`features`/`stories` carry both the live ADO tracking fields
  (`localKey`, `adoId`, `adoUrl`, `title`, `state`, `stateBucket`) and the full
  generated content (description, acceptance criteria, platform tags, estimates,
  ...). `title` always comes from ADO — it's the canonical ticket title.
- Story content fields vary by which pipeline generated them: newer stories use
  `story_id`/`as_a`/`i_want`/`so_that`/`acceptance_criteria`/`platform`/
  `estimated_points`; older ones use `persona`/`goal`/`benefit`/
  `acceptanceCriteria`/`technical_notes`/`effort`. Whatever the artifact actually
  contains is passed through as-is — expect to handle both shapes.
- A feature that had stories but lost every one of them to a `stream` filter is
  omitted entirely rather than returned with an empty `stories` array.
- If the underlying content artifact can't be found (e.g. a very old workflow),
  `epics`/`features` still contain the ADO tracking fields, just without the
  extra content properties.

## Response shape — `mode=qa`

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
      "story_ref": "F1.S1",
      "steps": ["..."],
      "expectedResult": "..."
    }
  ],
  "testPlans": [
    { "planId": 555, "planUrl": "https://dev.azure.com/.../_testPlans/555", "testCaseCount": 18 }
  ]
}
```

`stream` filtering in `qa` mode works by resolving each test case's `story_ref`
back to the story it covers (and that story's platform tags) — a test case whose
`story_ref` can't be resolved is always included rather than dropped.

## Errors

All errors are `{ "error": "<message>" }`.

| Status | When |
|--------|------|
| 400 | `seqNum` isn't a positive integer, `mode` isn't `dev`/`qa`, or `stream` contains a value outside `backend`/`web`/`ios`/`android` |
| 404 | No initiative has that `seqNum`, the initiative is archived, or it has never been pushed to Azure DevOps (no tickets to return) |
| 500 | Unexpected server error |

## Implementation

`app/backend/src/routes/dev-tickets-routes.ts`, mounted at `/api/dev/initiatives`
in `server.ts`. Backlog/QA-artifact parsing and platform filtering live in
`@pap/shared` (`backlog-helpers.ts`, `qa-test-helpers.ts`) so this route, the
Progress Tracker detail page, and the live artifact viewer all interpret the same
artifact JSON the same way.
