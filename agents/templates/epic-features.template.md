Produce a single valid JSON object wrapped in a ```json code block with this exact structure. No prose before or after — just the JSON block.

## Scope Rules (apply before writing a single feature)

1. **Max 5 features per phase** — if a phase needs more, create a new phase instead.
2. **Max 4 phases** — MVP, Phase 1, Phase 2, Phase 3. No custom labels.
3. **Feature scope check** — every feature must decompose into at most 6-8 user stories. If it would need more, split it into two features now.
4. **Each phase must be independently deployable** — a phase that can't ship on its own is not a phase.

---

## Structure

```json
{
  "epic": {
    "title": "Short initiative name (3-6 words)",
    "description": "One sentence: what capability this initiative delivers to users",
    "businessValue": "Why this matters to the business (revenue, retention, compliance, etc.)",
    "prdLink": "Initiative name from context"
  },
  "phases": [
    {
      "label": "MVP",
      "epicTitle": "MVP — [3-5 word deliverable name]",
      "deliverable": "One sentence: what users can do after this phase ships — must be independently useful",
      "features": [
        {
          "title": "Feature name (e.g., Real-time Message Delivery)",
          "description": "What user capability this feature unlocks — one sentence, user perspective",
          "acceptanceCriteria": [
            "Feature-level testable condition 1 (what must be true when this feature is complete)",
            "Feature-level testable condition 2",
            "Feature-level testable condition 3"
          ],
          "prdRef": {
            "functionalRequirements": ["FR-01", "FR-03"],
            "userJourneys": ["Trading · Share trade idea"]
          },
          "deferredTo": null,
          "stories": []
        }
      ]
    },
    {
      "label": "Phase 1",
      "epicTitle": "Phase 1 — [3-5 word deliverable name]",
      "deliverable": "One sentence: what Phase 1 adds on top of MVP — must be independently deployable",
      "features": []
    }
  ],
  "outOfScope": [
    "Voice messaging — deferred to Phase 2",
    "Video chat — not planned",
    "Desktop app — mobile-only MVP"
  ]
}
```

---

## Field Definitions

### Epic (initiative-level header)

- **title**: The overarching initiative theme. 3-6 words. Memorable but informative.
- **description**: What the initiative enables. One sentence, user-centric.
- **businessValue**: Why the business is investing in this. Tie to metrics when possible.
- **prdLink**: Reference to the PRD or initiative name for traceability.

### Phase

- **label**: Exactly one of: `"MVP"`, `"Phase 1"`, `"Phase 2"`, `"Phase 3"`. Use in order.
- **epicTitle**: The ADO/Jira epic title for this phase. Format: `"[Phase label] — [Short name]"`.
- **deliverable**: One sentence on what the user can do after this phase ships. Must be independently releasable.
- **features**: 1-5 features for this phase. Each is a narrow, independently implementable capability.

### Feature

- **title**: Clear, outcome-focused. Examples: "Message Threading", "Typing Indicators", "Push Notifications". One capability per feature.
- **description**: What the user can do with this feature they couldn't before. One sentence.
- **acceptanceCriteria**: 3-5 feature-level conditions. Not story-level. High-level "what must be true" statements. Examples:
  - "Users can send and receive text messages in under 500ms"
  - "Messages persist for 7 years to meet compliance requirements"
- **prdRef**: Which functional requirements and user journeys this feature satisfies. Use exact FR IDs from the PRD.
- **deferredTo**: If this feature was scoped for this phase but is being moved out, note the target phase. Otherwise `null`.
- **stories**: MUST be an empty array `[]`. User stories are added later by the story decomposition agent.

### Out of Scope

List anything explicitly NOT being built, or deferred to a later phase. Prevents scope creep.

---

## CRITICAL RULES

1. **NO USER STORIES** — Do not write "As a user, I want...". That's the job of the story decomposition agent.
2. **NO TECHNICAL TASKS** — Do not reference implementation details (databases, APIs, repos, frameworks).
3. **MAX 5 FEATURES PER PHASE** — If you need more, add a phase. If you've used all 4 phases, defer to outOfScope.
4. **MAX 4 PHASES** — MVP, Phase 1, Phase 2, Phase 3. No custom labels, no "Phase 4".
5. **FEATURE SCOPE CHECK** — Every feature must be decomposable into ≤8 user stories. Wide features must be split.
6. **PHASE DELIVERABLES** — Every phase must have a `deliverable` describing what ships independently.
7. **MVP DISCIPLINE** — MVP is the minimum to validate the hypothesis. Most features belong in Phase 1+.
8. **PHASE LABELS** — Must be exactly "MVP", "Phase 1", "Phase 2", "Phase 3". No TBD or missing values.
9. **ACCEPTANCE CRITERIA** — Feature-level only. 3-5 per feature. Testable and outcome-focused.

---

## Example Output (Messaging Feature)

```json
{
  "epic": {
    "title": "In-App Messaging & Trade Chat",
    "description": "Enable traders to discuss ideas and share trade setups within the app in real time",
    "businessValue": "Reduces churn by keeping users in-app instead of switching to Discord/WhatsApp. Target: 15% increase in daily active users.",
    "prdLink": "TradeEasy Mobile — In-App Messaging"
  },
  "phases": [
    {
      "label": "MVP",
      "epicTitle": "MVP — Core Chat Infrastructure",
      "deliverable": "Users can create chat rooms, send text messages, and have those messages delivered in real time",
      "features": [
        {
          "title": "Real-time Message Delivery",
          "description": "Users can send and receive text messages in chat rooms with sub-second latency",
          "acceptanceCriteria": [
            "Messages delivered in under 500ms at peak load",
            "Messages persist and sync across devices",
            "Offline messages delivered when user reconnects"
          ],
          "prdRef": {
            "functionalRequirements": ["FR-01", "FR-02"],
            "userJourneys": ["Trading · Share trade idea"]
          },
          "deferredTo": null,
          "stories": []
        },
        {
          "title": "Chat Room Management",
          "description": "Users can create, join, and leave topic-based chat rooms",
          "acceptanceCriteria": [
            "Users can create public and private rooms",
            "Room creators can manage member list",
            "Users can leave rooms and rejoin later"
          ],
          "prdRef": {
            "functionalRequirements": ["FR-03"],
            "userJourneys": ["Social · Join community"]
          },
          "deferredTo": null,
          "stories": []
        },
        {
          "title": "Ticker Card Sharing",
          "description": "Users can share a live stock ticker card directly into any chat",
          "acceptanceCriteria": [
            "Ticker cards show current price and % change",
            "Tapping a card navigates to the instrument detail page",
            "Cards render in under 200ms"
          ],
          "prdRef": {
            "functionalRequirements": ["FR-04"],
            "userJourneys": ["Trading · Share trade idea"]
          },
          "deferredTo": null,
          "stories": []
        }
      ]
    },
    {
      "label": "Phase 1",
      "epicTitle": "Phase 1 — Safety & Engagement",
      "deliverable": "Users are protected by automated content moderation and receive push notifications for new messages",
      "features": [
        {
          "title": "Content Moderation",
          "description": "System automatically flags messages containing prohibited content for review",
          "acceptanceCriteria": [
            "Hate speech and pump-and-dump signals are auto-flagged within 1 second",
            "Flagged messages are quarantined and reviewed within 24 hours",
            "Repeat offenders are warned or banned after 3 violations"
          ],
          "prdRef": {
            "functionalRequirements": ["FR-07"],
            "userJourneys": []
          },
          "deferredTo": null,
          "stories": []
        },
        {
          "title": "Push Notifications",
          "description": "Users receive notifications for new messages when the app is backgrounded",
          "acceptanceCriteria": [
            "Notifications delivered within 2 seconds of message send",
            "Users can mute individual rooms",
            "Notification deep-links to the correct chat thread"
          ],
          "prdRef": {
            "functionalRequirements": ["FR-05"],
            "userJourneys": ["Social · Stay updated"]
          },
          "deferredTo": null,
          "stories": []
        }
      ]
    }
  ],
  "outOfScope": [
    "Voice messaging — no audio infrastructure planned",
    "Video chat — not in scope for this initiative",
    "Desktop app — mobile-only for MVP and Phase 1",
    "Direct messages (DMs) — MVP and Phase 1 are group chats only",
    "Message reactions (emoji) — Phase 2 after user feedback on core chat"
  ]
}
```
