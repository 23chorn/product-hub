# Stream-Specific Developer Workflow

This guide explains how backend, iOS, Android, and web developers pull only their relevant tickets and work on them in the correct dependency order.

## Overview

The manifest endpoint supports a `stream` parameter that filters tickets by platform and returns a **stream-specific implementation order**. This ensures:
- Backend devs only see backend tickets
- iOS devs only see iOS tickets
- Each stream gets a topologically-sorted order respecting dependencies
- Cross-stream dependencies are handled gracefully

## Streams

Product Hub recognizes four streams:
- **`backend`** — Node.js/Python/Go backend services, APIs, databases
- **`web`** — React/Vue/Angular web frontend
- **`ios`** — Swift/SwiftUI iOS app
- **`android`** — Kotlin/Java Android app

Stories are tagged with `platform: ["backend"]`, `platform: ["ios", "backend"]`, etc. based on the `technical_notes` field (legacy) or explicit `platform` field (new format).

## Workflow: Backend Developer

### Step 1: Pull Backend Manifest

```bash
curl "http://localhost:3001/api/dev/initiatives/123/manifest?stream=backend"
```

**Response (filtered to backend only):**
```json
{
  "initiative": {
    "seqNum": 123,
    "title": "Add Price Alerts",
    "context": { "overview": "...", "constraints": [...] }
  },
  "epic": {
    "title": "Price Monitoring & Notifications",
    "businessValue": "Increases user engagement by 30%"
  },
  "features": [
    {
      "localKey": "F0",
      "title": "Backend Price Tracking",
      "phase": "MVP",
      "storyCount": 3,
      "totalPoints": 8
    }
  ],
  "tickets": [
    {
      "localKey": "F0.S0",
      "title": "Poll external price APIs on configurable intervals",
      "platform": ["backend"],
      "estimatedPoints": 3,
      "dependsOn": []
    },
    {
      "localKey": "F0.S1",
      "title": "Cache price data in Redis with TTL",
      "platform": ["backend"],
      "estimatedPoints": 2,
      "dependsOn": ["F0.S0"]
    },
    {
      "localKey": "F0.S2",
      "title": "Detect price threshold breaches and emit events",
      "platform": ["backend"],
      "estimatedPoints": 3,
      "dependsOn": ["F0.S0", "F0.S1"]
    }
  ],
  "implementationOrder": ["F0.S0", "F0.S1", "F0.S2"],
  "stream": ["backend"]
}
```

**What happened:**
- Tickets are filtered to `platform: ["backend"]`
- iOS ticket `F1.S0` (push notifications) is excluded
- `implementationOrder` contains only backend tickets in dependency order

### Step 2: Pull First Batch

Backend dev fetches the first ticket(s) from `implementationOrder`:

```bash
curl "http://localhost:3001/api/dev/initiatives/123/tickets/payload?ids=F0.S0"
```

**Response includes:**
- Full user story (persona/goal/benefit)
- Acceptance criteria (functional + technical)
- Resolved FRs/NFRs (what business rules to implement, what thresholds to meet)
- Feature description (context for this capability)
- Agent context (API details, existing infra)
- Platform-specific technical notes

### Step 3: Implement → Repeat

After completing `F0.S0`, backend dev pulls the next batch:

```bash
curl "http://localhost:3001/api/dev/initiatives/123/tickets/payload?ids=F0.S1,F0.S2"
```

Both tickets are ready because their dependencies (`F0.S0`) are complete.

## Workflow: iOS Developer

### Step 1: Pull iOS Manifest

```bash
curl "http://localhost:3001/api/dev/initiatives/123/manifest?stream=ios"
```

**Response:**
```json
{
  "tickets": [
    {
      "localKey": "F1.S0",
      "title": "Integrate with APNS for iOS push delivery",
      "platform": ["ios"],
      "estimatedPoints": 3,
      "dependsOn": ["F0.S2"]
    },
    {
      "localKey": "F1.S1",
      "title": "Add iOS UI for alert threshold configuration",
      "platform": ["ios"],
      "estimatedPoints": 2,
      "dependsOn": []
    }
  ],
  "implementationOrder": ["F1.S1"],
  "blockedTickets": ["F1.S0"],
  "stream": ["ios"]
}
```

**What happened:**
- `F1.S0` depends on `F0.S2` (backend event emission)
- `F0.S2` is **not in the iOS stream** → cross-stream dependency
- `F1.S0` is marked as **blocked** and excluded from `implementationOrder`
- `F1.S1` is independent → appears in `implementationOrder`

### Step 2: Work on Independent Tickets First

iOS dev can immediately start on `F1.S1` (UI configuration) while backend completes `F0.S2`.

### Step 3: Check When Blocked Ticket Unblocks

iOS dev polls the manifest or checks ADO to see when `F0.S2` (backend dependency) is marked "Done". Once unblocked, they fetch it:

```bash
curl "http://localhost:3001/api/dev/initiatives/123/tickets/payload?ids=F1.S0"
```

## Cross-Stream Dependencies

### Scenario: Backend Story Depends on iOS Story

If `F0.S3` (backend analytics endpoint) depends on `F1.S2` (iOS event tracking):

**Backend manifest (`stream=backend`):**
```json
{
  "tickets": [
    { "localKey": "F0.S0", ... },
    { "localKey": "F0.S1", ... },
    { "localKey": "F0.S2", ... },
    { "localKey": "F0.S3", "dependsOn": ["F1.S2"] }
  ],
  "implementationOrder": ["F0.S0", "F0.S1", "F0.S2"],
  "blockedTickets": ["F0.S3"]
}
```

`F0.S3` is **blocked** because its dependency `F1.S2` (iOS) is outside the backend stream.

**iOS manifest (`stream=ios`):**
```json
{
  "tickets": [
    { "localKey": "F1.S0", ... },
    { "localKey": "F1.S1", ... },
    { "localKey": "F1.S2", "dependsOn": [] }
  ],
  "implementationOrder": ["F1.S1", "F1.S2", "F1.S0"]
}
```

iOS dev works through their order. Once `F1.S2` is done (marked in ADO), backend dev can unblock `F0.S3`.

## Multi-Platform Stories

Some stories touch multiple platforms. Example:

```json
{
  "localKey": "F2.S0",
  "title": "Sync user preferences across devices",
  "platform": ["backend", "ios", "android"],
  "technicalNotes": {
    "backend": "Add /preferences GET/PUT endpoints with optimistic locking",
    "ios": "Call sync on app foreground, store locally with CoreData",
    "android": "Call sync on app foreground, store locally with Room"
  }
}
```

This story appears in **all three streams**:
- `?stream=backend` → shows `F2.S0` with backend technical notes
- `?stream=ios` → shows `F2.S0` with iOS technical notes
- `?stream=android` → shows `F2.S0` with Android technical notes

Each stream's dev implements their portion. Coordination happens via:
1. **Shared acceptance criteria** — defines the contract (API shape, data model, behavior)
2. **Technical ACs** — platform-specific testable conditions
3. **ADO sync** — each dev marks their portion complete; story closes when all platforms done

## No Stream Filter (Full Initiative View)

Omit the `stream` param to see everything:

```bash
curl "http://localhost:3001/api/dev/initiatives/123/manifest"
```

Returns all tickets across all platforms with a global implementation order. Useful for:
- Project managers tracking overall progress
- Tech leads coordinating cross-stream work
- Architects reviewing the full scope

## Benefits

✅ **Stream isolation** — Backend devs never see iOS tickets  
✅ **Correct dependency order** — Topo sort respects within-stream dependencies  
✅ **Cross-stream awareness** — Blocked tickets surfaced explicitly  
✅ **Parallel work** — Multiple streams work independently on non-blocked tickets  
✅ **Multi-platform clarity** — Stories touching multiple platforms appear in each relevant stream with platform-specific context  

## Advanced: Headless Claude Code Instance

```bash
#!/bin/bash
INITIATIVE=123
STREAM=backend

# 1. Fetch backend manifest
MANIFEST=$(curl -s "http://localhost:3001/api/dev/initiatives/$INITIATIVE/manifest?stream=$STREAM")

# 2. Extract implementation order
ORDER=$(echo "$MANIFEST" | jq -r '.implementationOrder[]')

# 3. Fetch first batch (first 3 tickets)
BATCH=$(echo "$ORDER" | head -3 | paste -sd ',' -)
TICKETS=$(curl -s "http://localhost:3001/api/dev/initiatives/$INITIATIVE/tickets/payload?ids=$BATCH")

# 4. For each ticket:
#    - Parse FR/NFR constraints
#    - Read feature description for context
#    - Implement story (persona/goal/benefit + ACs + technical ACs)
#    - Run tests
#    - Commit

echo "$TICKETS" | jq -r '.tickets[] | .localKey + ": " + .title'
# Output:
# F0.S0: Poll external price APIs on configurable intervals
# F0.S1: Cache price data in Redis with TTL
# F0.S2: Detect price threshold breaches and emit events
```

Claude Code receives:
- **Initiative context** (problem, users, metrics, constraints)
- **Epic context** (business value)
- **Feature context** (description, phase, FRs/NFRs)
- **Story detail** (persona/goal/benefit, ACs, technical ACs, platform notes)
- **Requirements** (resolved FRs/NFRs with full text)
- **Implementation order** (respecting dependencies within the stream)

No ambiguity. No document hunting. Just clean, ordered, context-rich tickets.
