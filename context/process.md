# Development Process

## Sprint cadence

- **Length:** Kanban
- **Planning:** Refinement 1 session per week (1 hour)
- **Standup:** Daily sync in-person at 10 AM local time, falls back to teams call if required
- **Review:** Friday of sprint end — demo to stakeholders (30 min)
- **Retro:** Friday of sprint end — team only (45 min)

## Definition of Ready

A story is ready for sprint when:
- Clear Problem Statement - The business problem or need is described in one or two sentences.
- Defined Scope - The expected change, flow, or behaviour is outlined (even at a high level).
- Acceptance Criteria Provided - Written in simple, testable statements.
- Dependencies Identified - Any API, design, data, or cross‑team dependency is noted.
- Design / UX Provided (if applicable) - Figma link, wireframe, or screenshot has been attached.
- Assumptions or Limitations Listed - Any relevant constraints are documented.
- No Blocking Questions - The team can begin without needing clarification.

## Definition of Done

A story is done when:
- Functionality Implemented - Meets all acceptance criteria.
- Peer Reviewed - Code review completed and passed.
- Tested - Unit tests (if applicable) written and passing & QA has verified the feature against the acceptance criteria.
- No Critical or High Bugs Open - Any discovered issues blocking ticket completion are resolved.
- Documentation Updated - Wiki pages updated (if needed).
- Feature Demoed or Communicated - Demo provided to Product / team

## Branching and release

## Team roles

| Role | Who | Responsibilities |
|------|-----|-----------------|
| PM | 1 PMs | Prioritization, story writing, stakeholder alignment |
| Engineering | 6 engineers (2 mobile frontend (iOS, Android), 3 backend, 1 web frontend) | Implementation, code review, on-call |
| Design | 1 designer | UI/UX mockups, design system maintenance | aids with Product work |
| QA | 2 dedicated QA | QAs own testing; PM owns final output |
| On-call | No official rota | incident response |

## Localization & translation

All user-facing features ship in English and Arabic (RTL). This is a solved, standardised process — do **not** raise it as an open question, risk, dependency, or blocker on individual features:

- Source copy is authored in English.
- Arabic translations are produced with AI, then reviewed internally by a native Arabic speaker before release. This applies to every feature by default.
- Localized strings are managed per platform (i18next en/ar on web; SwiftGen-generated EN/AR on iOS; the equivalent on Android — see repos.md).

Treat Arabic localization as standard delivery work covered by this process. It can be referenced as the established approach in documents where relevant, but must not be flagged as a gap, unresolved decision, or per-feature review gate.

## Estimation

- Story points: 1 (trivial), 2 (small), 3 (medium), 5 (large), 8 (too big — split it)
- Anything estimated at 8+ must be broken down before entering a the queue

