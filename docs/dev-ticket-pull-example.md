# Developer Ticket Pull Example

This guide shows how to fetch tickets from Product Hub for a given initiative using the dev endpoint.

## Overview

The `/api/dev/initiatives/:seqNum/*` endpoints provide a read-only view of everything Product Hub generated for an initiative:
- **Initiative-level context** (research, PRD overview, architecture summary)
- **Epic-level context** (business value, high-level description)
- **Feature-level context** (phase grouping, deliverable description, acceptance criteria)
- **Story-level detail** (user story format, technical ACs, platform tags, dependencies, estimates)

## Four-Tier Hierarchy

```
Initiative (#123: "Add Price Alerts")
  ├─ Context: problem statement, target users, success metrics, constraints, out-of-scope
  │
  ├─ Epic: "Price Monitoring & Notifications"
  │   └─ Business value, description
  │
  ├─ Feature F0: "Backend Price Tracking" (Phase: MVP)
  │   ├─ Description, acceptance criteria
  │   ├─ Story F0.S0: "As a backend service, I want to poll external APIs..."
  │   ├─ Story F0.S1: "As a backend service, I want to cache price data..."
  │   └─ Story F0.S2: "As a backend service, I want to detect price changes..."
  │
  ├─ Feature F1: "iOS Push Notifications" (Phase: MVP)
  │   ├─ Story F1.S0: "As an iOS user, I want to receive push alerts..."
  │   └─ Story F1.S1: "As an iOS user, I want to customize alert thresholds..."
  │
  └─ Feature F2: "Android Push Notifications" (Phase: Phase 2)
      └─ Story F2.S0: "As an Android user, I want to receive push alerts..."
```

## Step 1: Load the Manifest

The manifest provides initiative context, feature phasing, and a topologically-sorted implementation order.

**Option A: Full initiative (all streams):**
```bash
curl http://localhost:3001/api/dev/initiatives/123/manifest
```

**Option B: Stream-specific (backend only):**
```bash
curl "http://localhost:3001/api/dev/initiatives/123/manifest?stream=backend"
```

Use `stream=backend|web|ios|android` to filter tickets by platform. The manifest returns:
- Only tickets tagged with that platform
- Stream-specific implementation order (respecting within-stream dependencies)
- `blockedTickets[]` — stories with cross-stream dependencies (e.g., iOS story depends on backend story)

**Response:**
```json
{
  "initiative": {
    "seqNum": 123,
    "id": "item_abc123",
    "title": "Add Price Alerts",
    "context": {
      "overview": "Enable users to receive notifications when stock prices hit target thresholds",
      "problemStatement": "Users miss optimal buy/sell opportunities because they can't monitor prices 24/7",
      "targetUsers": ["Active traders", "Long-term investors", "Price-conscious buyers"],
      "successMetrics": {
        "primary": "30% of users set at least one price alert within first week",
        "secondary": [
          "Alert delivery within 60 seconds of threshold breach",
          "15% increase in trade execution rate"
        ]
      },
      "strategicAlignment": "Aligns with Q3 goal to increase user engagement and trading volume",
      "constraints": [
        "Must support 100k active alerts with <60s latency",
        "iOS push notification infrastructure already exists"
      ],
      "outOfScope": [
        "Email notifications (Phase 2)",
        "SMS alerts (future consideration)"
      ]
    }
  },
  "epic": {
    "localKey": "epic",
    "adoId": 12345,
    "adoUrl": "https://dev.azure.com/myorg/MyProject/_workitems/edit/12345",
    "title": "Price Monitoring & Notifications",
    "description": "Build backend polling system and mobile push notification delivery",
    "businessValue": "Increases user engagement by 30% and enables users to act on price movements",
    "state": "Active",
    "stateBucket": "in_progress"
  },
  "features": [
    {
      "localKey": "F0",
      "adoId": 12346,
      "adoUrl": "https://dev.azure.com/myorg/MyProject/_workitems/edit/12346",
      "title": "Backend Price Tracking",
      "description": "Poll external APIs, cache data, detect threshold breaches",
      "phase": "MVP",
      "storyCount": 3,
      "totalPoints": 8,
      "state": "Active",
      "stateBucket": "not_started"
    },
    {
      "localKey": "F1",
      "adoId": 12347,
      "title": "iOS Push Notifications",
      "phase": "MVP",
      "storyCount": 2,
      "totalPoints": 5
    },
    {
      "localKey": "F2",
      "title": "Android Push Notifications",
      "phase": "Phase 2",
      "storyCount": 1,
      "totalPoints": 3
    }
  ],
  "tickets": [
    {
      "localKey": "F0.S0",
      "adoId": 12348,
      "adoUrl": "https://dev.azure.com/myorg/MyProject/_workitems/edit/12348",
      "title": "Poll external price APIs on configurable intervals",
      "featureLocalKey": "F0",
      "featureTitle": "Backend Price Tracking",
      "phase": "MVP",
      "estimatedPoints": 3,
      "platform": ["backend"],
      "dependsOn": [],
      "state": "New",
      "stateBucket": "not_started"
    },
    {
      "localKey": "F0.S1",
      "title": "Cache price data in Redis with TTL",
      "estimatedPoints": 2,
      "platform": ["backend"],
      "dependsOn": ["F0.S0"]
    },
    {
      "localKey": "F0.S2",
      "title": "Detect price threshold breaches and emit events",
      "estimatedPoints": 3,
      "platform": ["backend"],
      "dependsOn": ["F0.S0", "F0.S1"]
    },
    {
      "localKey": "F1.S0",
      "title": "Integrate with APNS for iOS push delivery",
      "estimatedPoints": 3,
      "platform": ["ios"],
      "dependsOn": ["F0.S2"]
    },
    {
      "localKey": "F1.S1",
      "title": "Add iOS UI for alert threshold configuration",
      "estimatedPoints": 2,
      "platform": ["ios"],
      "dependsOn": []
    },
    {
      "localKey": "F2.S0",
      "title": "Integrate with FCM for Android push delivery",
      "estimatedPoints": 3,
      "platform": ["android"],
      "dependsOn": ["F0.S2"]
    }
  ],
  "implementationOrder": [
    "F0.S0",
    "F1.S1",
    "F0.S1",
    "F0.S2",
    "F1.S0",
    "F2.S0"
  ]
}
```

**Key fields:**
- `initiative.context`: High-level strategic context (problem, users, metrics, constraints, out-of-scope)
- `features[].phase`: Delivery phase (MVP, Phase 2, etc.)
- `tickets[].dependsOn`: Story dependencies (local keys)
- `implementationOrder`: Topologically-sorted ticket sequence respecting dependencies

## Step 2: Pull Ticket Details for a Batch

Use the manifest's `implementationOrder` to determine which tickets to work on next, then fetch full detail:

```bash
curl "http://localhost:3001/api/dev/initiatives/123/tickets/payload?ids=F0.S0,F0.S1"
```

**Response:**
```json
{
  "initiative": {
    "seqNum": 123,
    "id": "item_abc123",
    "title": "Add Price Alerts"
  },
  "tickets": [
    {
      "localKey": "F0.S0",
      "adoId": 12348,
      "adoUrl": "https://dev.azure.com/myorg/MyProject/_workitems/edit/12348",
      "state": "New",
      "stateBucket": "not_started",
      "featureLocalKey": "F0",
      "featureTitle": "Backend Price Tracking",
      "featureDescription": "Poll external APIs, cache data, detect threshold breaches",
      "phase": "MVP",
      "title": "Poll external price APIs on configurable intervals",
      "storyId": "F0.S0",
      "persona": "backend service",
      "goal": "poll external price APIs every N seconds where N is configurable per alert",
      "benefit": "users receive timely notifications when prices change",
      "acceptanceCriteria": [
        "Given a user has set a price alert, When the polling interval elapses, Then the system fetches the latest price from the external API",
        "Given the external API is unavailable, When a polling attempt fails, Then the system logs the error and retries with exponential backoff",
        "Given an alert has a custom polling interval, When the interval is reached, Then that alert polls independently of others"
      ],
      "technicalAcceptanceCriteria": [
        "Polling intervals stored in the alerts table with a default of 60s",
        "Background job scheduler (e.g. node-cron) orchestrates polling tasks",
        "API client handles rate limits and circuit breaking"
      ],
      "agentContext": "External API: CoinGecko (free tier: 50 calls/min). Existing infra: Node.js backend, PostgreSQL, no job queue yet.",
      "estimatedPoints": 3,
      "estimatedHours": 3,
      "platform": ["backend"],
      "dependsOn": [],
      "technicalNotes": {
        "backend": "Add a PricePoller service with configurable intervals per alert. Use node-cron for scheduling. Handle rate limits with exponential backoff."
      },
      "functionalRequirements": [
        {
          "id": "FR-01",
          "requirement": "The system shall poll external price APIs at user-configurable intervals"
        },
        {
          "id": "FR-03",
          "requirement": "The system shall detect when a price crosses a user-defined threshold and trigger a notification event"
        }
      ],
      "nonFunctionalRequirements": [
        {
          "id": "NFR1",
          "category": "Performance",
          "requirement": "Price data must be fetched and cached within 2 seconds at p95",
          "priority": "Must"
        },
        {
          "id": "NFR2",
          "category": "Scalability",
          "requirement": "The system must support 100,000 active price alerts with independent polling intervals",
          "priority": "Must"
        }
      ]
    },
    {
      "localKey": "F0.S1",
      "title": "Cache price data in Redis with TTL",
      "persona": "backend service",
      "goal": "cache fetched price data in Redis to reduce API calls",
      "benefit": "improves response time and reduces external API costs",
      "acceptanceCriteria": [
        "Given a price is fetched from the API, When it's successfully retrieved, Then it's cached in Redis with a TTL of 60s",
        "Given a cached price exists, When a subsequent request arrives within the TTL window, Then the cached value is returned without hitting the API"
      ],
      "technicalAcceptanceCriteria": [
        "Redis key format: `price:{symbol}` with 60s TTL",
        "Cache hits logged for observability"
      ],
      "estimatedPoints": 2,
      "platform": ["backend"],
      "dependsOn": ["F0.S0"],
      "technicalNotes": {
        "backend": "Integrate ioredis. Set TTL to match polling interval. Add cache metrics."
      }
    }
  ]
}
```

**Key fields:**
- `persona`, `goal`, `benefit`: User story structure
- `acceptanceCriteria`: Functional Given/When/Then scenarios
- `technicalAcceptanceCriteria`: Implementation-level testable conditions
- `agentContext`: Strategic context for this specific story (API details, existing infra, constraints)
- `technicalNotes`: Platform-specific implementation hints
- `dependsOn`: Stories that must complete first
- `functionalRequirements`: FRs this story satisfies (from PRD, traced via feature `prdRef`)
- `nonFunctionalRequirements`: NFRs this story must meet (performance, scalability, security thresholds)
- `featureDescription`: Parent feature's high-level description for context

## Step 3: Stream Filtering

**Recommended approach:** Use `stream` param on the **manifest endpoint** (Step 1) to get stream-specific tickets and implementation order.

**Legacy approach:** The full-tree `/tickets` endpoint also supports `stream`:
```bash
curl "http://localhost:3001/api/dev/initiatives/123/tickets?mode=dev&stream=backend"
```

See [stream-specific-workflow.md](./stream-specific-workflow.md) for detailed guidance on how backend/iOS/Android/web developers pull only their tickets and handle cross-stream dependencies.

## Usage Patterns

### Headless Claude Code Instance
```bash
# 1. Load manifest
MANIFEST=$(curl -s http://localhost:3001/api/dev/initiatives/123/manifest)

# 2. Parse implementation order
ORDER=$(echo "$MANIFEST" | jq -r '.implementationOrder[]')

# 3. Fetch first batch (first 3 tickets)
BATCH=$(echo "$ORDER" | head -3 | paste -sd ',' -)
curl -s "http://localhost:3001/api/dev/initiatives/123/tickets/payload?ids=$BATCH" | jq .

# 4. Claude Code receives:
#    - Initiative context (problem, users, metrics, constraints)
#    - Epic context (business value)
#    - Feature context (phase, deliverable description, ACs)
#    - Story detail (persona/goal/benefit, ACs, technical ACs, platform, dependencies)
```

### CI Pipeline Integration
```yaml
# .github/workflows/ticket-pull.yml
name: Pull Tickets for Initiative
on:
  workflow_dispatch:
    inputs:
      initiative_number:
        required: true

jobs:
  pull:
    runs-on: ubuntu-latest
    steps:
      - name: Fetch manifest
        run: |
          curl -s ${{ secrets.PRODUCT_HUB_URL }}/api/dev/initiatives/${{ inputs.initiative_number }}/manifest \
            > manifest.json
      
      - name: Parse tickets by stream
        run: |
          jq '.tickets[] | select(.platform | contains(["backend"]))' manifest.json \
            > backend-tickets.json
```

## Notes

- **No ADO calls**: This endpoint reads from the local `ado_work_item_map` cache — ticket state is last-synced snapshot, not live ADO state
- **Context layering**: Initiative → Epic → Feature → Story provides context at every level
- **Requirements traceability**: FRs and NFRs are resolved from the PRD via feature `prdRef` — developers see **why** they're building something and **what constraints** apply, without hunting through documents
- **Dependency resolution**: `implementationOrder` respects `dependsOn` (topological sort)
- **Platform filtering**: Use `stream` param to narrow by backend/web/ios/android
- **QA mode**: `?mode=qa` returns test cases instead of dev tickets

## Why FR/NFR Inclusion Matters

When a developer receives a ticket, they now get:
1. **Feature description** — high-level "what" this capability enables
2. **Functional requirements** — specific business rules this story must implement
3. **Non-functional requirements** — performance/scalability/security thresholds to meet
4. **Story acceptance criteria** — detailed Given/When/Then scenarios
5. **Technical acceptance criteria** — implementation-level testable conditions

This means a developer can confidently implement F0.S0 knowing:
- **FR-01**: Must support configurable intervals (not hardcoded)
- **FR-03**: Must trigger notification events (not just log)
- **NFR1**: 2-second latency ceiling at p95 (not "fast enough")
- **NFR2**: Must scale to 100k alerts (not optimized for 100)

No document hunting. No ambiguity. All business and technical decisions are right there in the ticket payload.
