# Backlog Ticket Schema

Work items are delivered as a **single accumulated JSON file** — the last stage to complete contains all features. Each stage appends its feature to the file, so `story_decomposition_F3.json` holds F1, F2, and F3. This document describes every field so a Claude Code instance can parse the artifact and map it accurately to implementation work.

---

## File Layout

Each `story_decomposition_F*` stage produces its own artifact file, accumulating all previous features:

```
data/sessions/{itemId}/
  story_decomposition_F1/artifacts/{timestamp}-story_decomposition_F1.json  ← F1 only
  story_decomposition_F2/artifacts/{timestamp}-story_decomposition_F2.json  ← F1 + F2
  story_decomposition_F3/artifacts/{timestamp}-story_decomposition_F3.json  ← F1 + F2 + F3 (complete)
```

**Pass the last file produced** (F3, or F2 if only two features ran). It contains the full backlog.

---

## Top-Level Structure

```json
{
  "epic":     { ... },
  "features": [ { ... }, { ... }, { ... } ]
}
```

| Field      | Type            | Description |
|------------|-----------------|-------------|
| `epic`     | object          | The overarching initiative — maps to an ADO Epic work item |
| `features` | array of object | All features in the epic, in order (F1, F2, F3). The last file produced contains all of them. |

---

## Epic

```json
{
  "epic": {
    "title":              "Virtual IBAN Deposits for Web",
    "description":        "Enable web platform users to fund their brokerage accounts via a unique, persistent Virtual IBAN.",
    "business_value":     "Unblocks the web platform as a viable trading surface; reduces friction vs. manual wire transfers.",
    "definition_of_done": "KYC-approved users on the web platform can retrieve their unique IBAN and complete a deposit end-to-end.",
    "out_of_scope": [
      "Mobile app IBAN support — separate initiative",
      "Multi-currency IBANs — EUR only for MVP"
    ]
  }
}
```

| Field               | Description |
|---------------------|-------------|
| `title`             | Short epic name. Used as the ADO Epic title. |
| `description`       | One sentence: what capability this epic delivers. |
| `business_value`    | Why this matters to the business — tied to metrics where possible. |
| `definition_of_done`| What "shipped" means at epic level — the high-level success condition. |
| `out_of_scope`      | Explicit exclusions agreed during planning. Helps prevent scope creep. |

---

## Feature

```json
{
  "key":         "F1",
  "title":       "IBAN Provisioning & Retrieval",
  "description": "Users can access a unique, persistent Virtual IBAN from the deposit screen without delays.",
  "phase":       "MVP",
  "acceptance_criteria": [
    "KYC-approved users can view their IBAN on the deposit screen within 2 seconds",
    "IBAN persists across sessions — provisioned once, cached thereafter",
    "Users without KYC approval see a clear prompt to complete verification"
  ],
  "stories":     [ { ... } ]
}
```

| Field                | Description |
|----------------------|-------------|
| `key`                | Feature reference used in story IDs (`F1`, `F2`, `F3`). Matches the ADO Feature created earlier. |
| `title`              | Feature name — maps to the ADO Feature title. |
| `description`        | What user capability this feature unlocks — written from the user's perspective, not technical components. |
| `phase`              | `MVP`, `Phase 2`, or `Phase 3` — indicates priority tier. |
| `acceptance_criteria`| 3–5 feature-level conditions. These are outcome-focused "what must be true when this feature is complete" statements — not story-level Gherkin. Use them to verify the feature as a whole before sign-off. |
| `stories`            | Array of user stories. Each maps to one ADO Product Backlog Item (or User Story). |

---

## Story

```json
{
  "story_id":   "F1.S3",
  "title":      "Backend IBAN provisioning and retrieval API endpoint",
  "as_a":       "KYC-approved web user",
  "i_want":     "to retrieve my unique Virtual IBAN via an API call",
  "so_that":    "the deposit screen can display it without calling the ENBD API on every page load",
  "acceptance_criteria": [
    "Given a KYC-approved user requests their IBAN When the backend receives the request Then it returns the cached IBAN within 100ms p95",
    "Given the user has no IBAN yet When they request one Then the backend provisions it via the ENBD API and stores it"
  ],
  "technical_acceptance_criteria": [
    "Backend: GET /api/v1/wallet/iban returns { iban, bankName, swiftCode, currency } with 200 for approved users, 403 for unapproved",
    "Backend: Redis cache key `iban:{userId}` with 24h TTL; cache miss triggers ENBD provisioning",
    "Web: Axios call in `useIbanQuery` (TanStack Query, staleTime: Infinity) — only fetches once per session"
  ],
  "platform":         ["backend", "web"],
  "estimated_points": 3,
  "depends_on":       ["F1.S1", "F1.S2"],
  "technical_notes":  "ENBD provisioning is synchronous but slow (~800ms). Cache hit path must be under 100ms. On provisioning failure return 503 with a retry-after header."
}
```

### Story Fields

| Field                          | ADO field                          | Description |
|--------------------------------|------------------------------------|-------------|
| `story_id`                     | —                                  | Unique reference key within this backlog (`F1.S1`, `F2.S3`). Used to express dependencies. |
| `title`                        | Title                              | Imperative sentence describing what is built. Appears as the ADO work item title. |
| `as_a`                         | Description                        | The user persona who benefits (maps to "As a …" in the ticket description). |
| `i_want`                       | Description                        | The action the persona wants to take (maps to "I want …"). |
| `so_that`                      | Description                        | The outcome for the persona (maps to "So that …"). |
| `acceptance_criteria`          | Acceptance Criteria                | Product-level, written in **Given / When / Then** Gherkin format. Testable conditions for sign-off. |
| `technical_acceptance_criteria`| Acceptance Criteria (after `<hr>`) | Engineering constraints that complement the product ACs — API contracts, performance bounds, error handling, caching rules. Prefixed ⚙ in ADO. |
| `platform`                     | Tags                               | Which streams own this story. Stored as semicolon-separated ADO tags. Use to filter tickets by team. |
| `estimated_points`             | Effort                             | Fibonacci story points (1 / 2 / 3 / 5 / 8). Reflects full delivery effort: implementation + tests + review. Max 8 — anything larger was split. |
| `depends_on`                   | —                                  | Array of `story_id` values this story must wait for. Stories are pre-ordered by dependency; this makes cross-story blocking explicit. |
| `technical_notes`              | Description                        | Free-form implementation guidance — specific risks, gotchas, or decisions made during refinement. Appended to the ADO description. |

### Platform Values

| Value       | Meaning |
|-------------|---------|
| `backend`   | .NET / C# API, services, jobs, database migrations |
| `web`       | React / TypeScript frontend (`xcube-web` repo) |
| `ios`       | Swift / SwiftUI iOS app |
| `android`   | Kotlin / Jetpack Compose Android app |

A story tagged `["backend", "web"]` means both a backend API change and a frontend consumer are needed — they may be separate tasks but are bundled into one ticket. If they can be picked up independently they are split into separate stories.

---

## Dependency Ordering

Stories within a feature are already sorted in dependency order — a story never depends on a later story in the list. The `depends_on` field makes blocking relationships explicit for cross-story and cross-feature dependencies.

Example ordering within a feature:
1. Database migration story — no dependencies
2. Backend API story — depends on migration
3. Frontend story — depends on backend API

**Do not pick up a story before its `depends_on` stories are complete.**

Cross-feature dependencies (e.g. F2.S1 depending on F1.S4) are also expressed via `depends_on` — check the referenced story's feature file if needed.

---

## How Fields Map to ADO

| JSON field                     | ADO field                          | Notes |
|--------------------------------|------------------------------------|-------|
| `story.title`                  | Title                              | |
| `as_a` + `i_want` + `so_that`  | Description (top)                  | Formatted as "As a / I want / So that" |
| `technical_notes`              | Description (below user story)     | Plain text appended |
| `acceptance_criteria`          | Acceptance Criteria                | Given/When/Then steps, keywords bolded |
| `technical_acceptance_criteria`| Acceptance Criteria (after `<hr>`) | Prefixed ⚙, separated from product ACs |
| `estimated_points`             | Effort                             | `Microsoft.VSTS.Scheduling.Effort` |
| `platform`                     | Tags                               | Semicolon-separated, e.g. `backend; web` |

---

## Working with the Backlog in Claude Code

Pass the last feature file (complete backlog). Use `backlog.js` (in this `docs/` folder) to slice it.

### Platform filter

At the top of `backlog.js` is a one-line config:

```js
const PLATFORM = 'web'; // 'web' | 'backend' | 'ios' | 'android' | null
```

Set this before running. Each team gets their own copy of the script set to their stream — only their stories are shown. Setting `null` returns all stories.

### Commands

```bash
# Summary table — all matching stories across all features
node docs/backlog.js F3.json

# Matching stories in one feature only
node docs/backlog.js F3.json F1

# A single story as markdown (platform filter ignored)
node docs/backlog.js F3.json F1.S3

# Raw JSON of all matching stories
node docs/backlog.js F3.json --json

# Raw JSON of one feature's matching stories
node docs/backlog.js F3.json --json F1

# Raw JSON of one story
node docs/backlog.js F3.json --json F1.S3
```

### Recommended workflow

1. Set `PLATFORM` in the script to your stream (`'web'` or `'backend'`)
2. Run `node docs/backlog.js F3.json > context.md` to capture all your stories as markdown
3. Open your repo in Claude Code and pass the context: `claude "Implement these stories in dependency order" < context.md`
4. Or work feature-by-feature: `node docs/backlog.js F3.json F1 | claude "Implement Feature 1 stories"`
5. Follow `depends_on` ordering — stories are pre-sorted but cross-stream dependencies (e.g. backend API must exist before web story) are explicit in the field

The full file contains everything Claude Code needs. Use feature key filtering (`F1`, `F2`, `F3`) to scope a session to one feature at a time.
