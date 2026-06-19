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
          "description": "2-3 sentences: (1) what the user gains from this feature, (2) why it matters to the product hypothesis or business outcome, (3) how it fits into this phase's deliverable",
          "rationale": "Why this feature belongs in this phase rather than earlier or later. One sentence.",
          "acceptanceCriteria": [
            "Feature-level testable condition referencing measurable thresholds where relevant (e.g. latency, error rate, data retention period)",
            "Feature-level testable condition 2 — specific enough that a QA engineer can verify it without ambiguity",
            "Feature-level testable condition 3"
          ],
          "prdRef": {
            "functionalRequirements": ["FR-01", "FR-03"],
            "nonFunctionalRequirements": ["NFR1", "NFR3"],
            "userJourneys": ["Trading · Share trade idea"]
          },
          "deferredTo": null,
          "dependsOn": [],
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
- **description**: 2-3 sentences. Sentence 1: what the user gains (a capability they didn't have before). Sentence 2: why it matters to the product hypothesis or business outcome. Sentence 3: how it connects to this phase's deliverable. Do not use vague language like "improves UX" — be specific about the outcome.
- **rationale**: One sentence explaining why this feature is in this phase rather than earlier or later. Forces deliberate scoping decisions.
- **acceptanceCriteria**: 3-5 feature-level conditions. Not story-level tasks. Must be testable by a QA engineer. Where an NFR defines a measurable threshold (latency, uptime, data retention), reference it explicitly. Examples:
  - "Messages are delivered to all channel members within 500ms at peak load (NFR2 — Performance)"
  - "Message history is retained for 7 years with cryptographic integrity verification (NFR5 — Data Retention)"
  - "Users can leave a channel and the system removes them from future message delivery within 1 second"
- **prdRef**: Traceability back to the PRD. Use exact IDs.
  - `functionalRequirements`: FR IDs this feature satisfies (e.g. `["FR-01", "FR-03"]`)
  - `nonFunctionalRequirements`: NFR IDs this feature must satisfy (e.g. `["NFR1", "NFR3"]`). Include any NFR that constrains this feature's behaviour, performance, or compliance. Empty array if none apply.
  - `userJourneys`: Journey names from the PRD this feature supports
- **deferredTo**: If this feature was scoped for this phase but is being moved out, note the target phase. Otherwise `null`.
- **dependsOn**: Array of EXACT feature titles (copy-pasted, case-sensitive) from elsewhere in this epic that this feature cannot start until they are done — i.e. building or changing this feature requires the depended-on feature's behavior or contract to already be settled. Empty array `[]` if this feature has no prerequisites and can be built in parallel with any other feature.
  - Reference features by their exact `title` string, including ones in earlier phases.
  - Do NOT invent IDs (no "F1", "F2") — titles only. The system resolves titles to IDs after generation.
  - Most features should have an EMPTY `dependsOn`. Only mark a dependency when a change to the other feature would force rework of this one (shared data contract, shared UI surface, sequential user journey step). Two features that merely live in the same phase are NOT automatically dependent.
  - Never depend on a feature in a LATER phase, and never create a circular dependency (A depends on B, B depends on A) — if you find yourself doing this, the features are too tightly coupled and should be merged into one feature instead.
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
10. **DEPENDENCY DISCIPLINE** — Default every feature's `dependsOn` to `[]`. Only add a prerequisite when truly blocking. Over-tagging dependencies defeats parallel delivery; under-tagging risks rework. When in doubt, leave it empty.

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
          "description": "Users can send and receive text messages in topic-based chat rooms with sub-second latency during market hours. This is the core interaction that keeps traders in-app instead of switching to Discord, directly supporting the 18% trade conversion uplift hypothesis. Without reliable delivery, every other feature in this initiative is worthless — it must ship first.",
          "rationale": "The foundational transport layer — nothing else in this initiative works without it. MVP is the right phase because it validates the core hypothesis before investing in enrichment features.",
          "acceptanceCriteria": [
            "Messages are delivered to all channel members within 500ms at p99 during market hours (NFR2 — Performance)",
            "Messages persist and are retrievable across devices for 7 years with cryptographic integrity verification (NFR5 — Data Retention)",
            "Offline messages are delivered automatically when the user reconnects within the same session",
            "Message send failures surface a user-visible error with a retry option within 3 seconds"
          ],
          "prdRef": {
            "functionalRequirements": ["FR-01", "FR-02"],
            "nonFunctionalRequirements": ["NFR2", "NFR5"],
            "userJourneys": ["Trading · Share trade idea"]
          },
          "deferredTo": null,
          "dependsOn": [],
          "stories": []
        },
        {
          "title": "Chat Room Management",
          "description": "Users can create, join, and leave topic-based chat rooms with configurable privacy settings. Room organisation is how traders self-select into relevant communities (ticker, sector, strategy), which drives the engagement retention metric. Without a room structure, the messaging transport has no context — users cannot find relevant conversations.",
          "rationale": "Inseparable from message delivery in MVP — a transport layer without addressable rooms has no product value.",
          "acceptanceCriteria": [
            "Users can create a room with a name, topic, and privacy setting (public or private) in under 3 taps",
            "Room creators can invite members to private rooms via a uniquely generated shareable link",
            "Users can leave a room at any time; the system removes them from future message delivery within 1 second",
            "A public room directory is searchable by name and topic tag"
          ],
          "prdRef": {
            "functionalRequirements": ["FR-03"],
            "nonFunctionalRequirements": [],
            "userJourneys": ["Social · Join community"]
          },
          "deferredTo": null,
          "dependsOn": [],
          "stories": []
        },
        {
          "title": "Ticker Card Sharing",
          "description": "Users can embed a live-updating stock ticker card directly into any message, letting recipients navigate to the instrument detail page with a single tap. This is the feature that connects social discussion to trade execution — the primary conversion mechanism in the product hypothesis. Phase 1 (after MVP validates basic messaging) is the earliest it can ship with confidence.",
          "rationale": "Requires stable message delivery from MVP before it can be built. Phase 1 is the correct slot — shipping it in MVP would risk over-scoping before core messaging is validated.",
          "acceptanceCriteria": [
            "Ticker cards are attachable from any instrument detail screen via a 'Share to Chat' button",
            "Cards render current price and percentage change within 200ms of message open (NFR2 — Performance)",
            "Tapping a ticker card navigates the recipient directly to the instrument detail screen",
            "Cards update in real time during market hours without requiring a message refresh or manual reload"
          ],
          "prdRef": {
            "functionalRequirements": ["FR-04"],
            "nonFunctionalRequirements": ["NFR2"],
            "userJourneys": ["Trading · Share trade idea"]
          },
          "deferredTo": null,
          "dependsOn": ["Real-time Message Delivery"],
          "stories": []
        }
      ]
    },
    {
      "label": "Phase 1",
      "epicTitle": "Phase 1 — Safety & Engagement",
      "deliverable": "Users are protected by automated content moderation and receive push notifications for new messages when the app is backgrounded",
      "features": [
        {
          "title": "Content Moderation",
          "description": "The system automatically flags messages containing prohibited content (hate speech, pump-and-dump signals) for human review within 1 second of send. Without moderation, regulatory exposure and community degradation will erode the retention gains from core messaging. Phase 1 is the right slot — the MVP needs real usage data before tuning moderation thresholds accurately.",
          "rationale": "Requires real message volume from MVP to tune signal detection thresholds before automating enforcement. Manual review queue ships in MVP as interim mitigation.",
          "acceptanceCriteria": [
            "Messages containing hate speech or pump-and-dump signals are auto-flagged within 1 second of send (NFR4 — Compliance)",
            "Flagged messages are quarantined from public view and assigned to a moderator review queue within 24 hours",
            "Users who accumulate 3 violations within 30 days receive a graduated response: warning → 7-day suspension → permanent ban",
            "Moderators can overturn flags and restore messages; false-positive rate is tracked and reported weekly"
          ],
          "prdRef": {
            "functionalRequirements": ["FR-07"],
            "nonFunctionalRequirements": ["NFR4"],
            "userJourneys": []
          },
          "deferredTo": null,
          "dependsOn": [],
          "stories": []
        },
        {
          "title": "Push Notifications",
          "description": "Users receive push notifications for new messages in joined channels when the app is backgrounded, with configurable muting per channel. Notifications close the re-engagement loop — without them, users must actively return to the app to see messages, which is the primary drop-off point for chat retention. Requires MVP message delivery to be stable before adding notification delivery complexity.",
          "rationale": "Depends on stable message delivery from MVP. Phase 1 is the earliest slot where notification reliability can be validated without risking the MVP scope.",
          "acceptanceCriteria": [
            "Push notifications are delivered within 2 seconds of message send at p95 (NFR2 — Performance)",
            "Users can mute notifications per channel independently of membership",
            "Tapping a notification deep-links the user directly to the correct channel and message thread",
            "Notification payload includes sender display name, channel name, and a 100-character message preview"
          ],
          "prdRef": {
            "functionalRequirements": ["FR-05"],
            "nonFunctionalRequirements": ["NFR2"],
            "userJourneys": ["Social · Stay updated"]
          },
          "deferredTo": null,
          "dependsOn": ["Real-time Message Delivery"],
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
