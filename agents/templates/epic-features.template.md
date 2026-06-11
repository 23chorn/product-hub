Produce a single valid JSON object wrapped in a ```json code block with this exact structure. No prose before or after — just the JSON block.

Right-size the output based on scope:

**Small scope (1-2 functional requirements)**: 2-3 features
**Medium scope (3-5 functional requirements)**: 4-6 features  
**Large scope (6+ functional requirements)**: 6-8 features

---

## Structure

```json
{
  "epic": {
    "title": "Short epic name (3-6 words)",
    "description": "One sentence: what capability this epic delivers to users",
    "businessValue": "Why this matters to the business (revenue, retention, compliance, etc.)",
    "prdLink": "Initiative name from context",
    "definitionOfDone": "What 'complete' means for this epic — high-level success criteria"
  },
  "features": [
    {
      "title": "Feature name (e.g., Real-time Message Delivery)",
      "description": "What user capability this feature unlocks — written from user perspective, not technical components",
      "phase": "MVP | Phase 2 | Phase 3",
      "acceptanceCriteria": [
        "Feature-level testable condition 1 (what must be true when this feature is complete)",
        "Feature-level testable condition 2",
        "Feature-level testable condition 3"
      ],
      "prdRef": {
        "functionalRequirements": ["FR-01", "FR-03"],
        "userJourneys": ["Trading · Share trade idea", "Social · Comment on positions"]
      },
      "deferredTo": null,
      "stories": []
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

### Epic

- **title**: The overarching initiative theme. Short and memorable.
- **description**: What the epic enables. One sentence, user-centric.
- **businessValue**: Why the business is investing in this. Tie to metrics when possible.
- **prdLink**: Reference to the PRD or initiative name for traceability.
- **definitionOfDone**: What "shipped" means at epic level — avoid implementation details.

### Feature

- **title**: Clear, outcome-focused. Avoid technical jargon. Examples: "Message Threading", "Typing Indicators", "Push Notifications".
- **description**: What the user can do with this feature that they couldn't before. Written from their perspective.
- **phase**: 
  - `MVP` — must ship in the first release to validate the hypothesis
  - `Phase 2` — valuable but can wait until after MVP validation
  - `Phase 3` — nice-to-have or far-future
- **acceptanceCriteria**: 3-5 feature-level conditions. Not story-level — these are the high-level "what must be true" statements. Examples:
  - "Users can send and receive text messages in under 500ms"
  - "Messages persist for 7 years to meet compliance requirements"
  - "Blocked users cannot see each other's messages"
- **prdRef**: Which functional requirements and user journeys this feature satisfies. Use exact FR IDs from the PRD.
- **deferredTo**: If this feature was originally scoped but is being moved out of MVP, note the target phase. Otherwise `null`.
- **stories**: MUST be an empty array `[]`. User stories will be added later by the story decomposition agent.

### Out of Scope

List anything explicitly NOT being built, or deferred to a later phase. This prevents scope creep and sets clear boundaries.

---

## CRITICAL RULES

1. **NO USER STORIES** — Do not write "As a user, I want...". That's the job of the story decomposition agent.
2. **NO TECHNICAL TASKS** — Do not reference implementation details (databases, APIs, repos, frameworks). That's the architect's job.
3. **FEATURE COUNT** — Must output 2-8 features. If you have 1 feature, split it. If you have 9+, group or defer.
4. **MVP DISCIPLINE** — Be ruthless about what's truly required for the first release. Most features should be Phase 2.
5. **PHASE LABELS** — Every feature must have a phase. No "TBD" or missing values.
6. **ACCEPTANCE CRITERIA** — Feature-level only. 3-5 per feature. Testable and outcome-focused.

---

## Example Output (Messaging Feature)

```json
{
  "epic": {
    "title": "In-App Messaging & Trade Chat",
    "description": "Enable traders to discuss ideas and share trade setups within the app in real time",
    "businessValue": "Reduces churn by keeping users in-app instead of switching to Discord/WhatsApp. Target: 15% increase in daily active users.",
    "prdLink": "TradeEasy Mobile — In-App Messaging",
    "definitionOfDone": "Users can create chat rooms, send text messages, share ticker cards, and have messages persist for 7 years"
  },
  "features": [
    {
      "title": "Real-time Message Delivery",
      "description": "Users can send and receive text messages in chat rooms with sub-second latency",
      "phase": "MVP",
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
      "phase": "MVP",
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
      "phase": "MVP",
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
    },
    {
      "title": "Content Moderation",
      "description": "System flags and quarantines messages containing prohibited content",
      "phase": "Phase 2",
      "acceptanceCriteria": [
        "Hate speech and pump-and-dump signals are auto-flagged",
        "Flagged messages are reviewed within 24 hours",
        "Repeat offenders are warned or banned"
      ],
      "prdRef": {
        "functionalRequirements": ["FR-07"],
        "userJourneys": []
      },
      "deferredTo": "Phase 2",
      "stories": []
    },
    {
      "title": "Push Notifications",
      "description": "Users receive notifications for new messages when app is backgrounded",
      "phase": "Phase 2",
      "acceptanceCriteria": [
        "Notifications delivered within 2 seconds of message send",
        "Users can mute individual rooms",
        "Notification deep-links to the correct chat thread"
      ],
      "prdRef": {
        "functionalRequirements": ["FR-05"],
        "userJourneys": ["Social · Stay updated"]
      },
      "deferredTo": "Phase 2",
      "stories": []
    }
  ],
  "outOfScope": [
    "Voice messaging — deferred to Phase 3",
    "Video chat — not planned",
    "Desktop app — mobile-only for MVP",
    "Direct messages (DMs) — MVP is group chats only",
    "Message reactions (emoji) — Phase 2 after user feedback"
  ]
}
```
