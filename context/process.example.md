# Development Process

> **How to use this file:** Copy to `process.md`, fill in your real details, and delete this note.
> `process.md` is gitignored — your process details stay local. This example uses a fictional company.

## Sprint cadence

- **Length:** 2-week sprints, Sunday to Thursday (GCC working week)
- **Planning:** Sunday morning of sprint start (90 min) — PM presents prioritised stories, team estimates and commits
- **Standup:** Daily async in Slack (#eng-standup) by 10 AM GST
- **Review:** Thursday of sprint end — demo to stakeholders and compliance (45 min)
- **Retro:** Thursday of sprint end — team only (30 min)

## Definition of Ready

A story is ready for sprint when:
- Acceptance criteria written and reviewed by PM
- Arabic copy reviewed by native Arabic speaker (for any user-facing text)
- Design mockups attached and signed off for all UI changes (both LTR and RTL layouts)
- Compliance impact assessed — any story touching order flow, account data, or client-facing content reviewed by legal/compliance
- Dependencies identified and unblocked
- Estimated by at least 2 engineers (iOS, Android, and backend represented if cross-platform)
- No open questions tagged `needs-clarification`

## Definition of Done

A story is done when:
- Code merged to `main` via approved PR (minimum 1 reviewer, 2 for trading/financial logic)
- Unit tests pass; integration tests pass for order flow and account management changes
- Deployed to `staging` and smoke-tested on both iOS and Android
- Arabic localisation strings added and validated (no English fallbacks in staging)
- PM has verified acceptance criteria on staging
- Compliance sign-off obtained if story touches regulated functionality (order types, KYC, disclosures)
- No regressions in core trading flows (automated regression suite must pass)

## Branching and release

- **Branch naming:** `feature/TICKET-123-short-description`, `fix/TICKET-456-bug-name`
- **PR rules:** Squash merge, linked to Jira ticket, CI must pass, no merge without review
- **Mobile releases:** Bi-weekly release train aligned to sprint end. Both iOS and Android ship together — no platform-first releases
- **Backend:** Continuous deploy to staging on merge to `main`; production deploy on manual trigger with two-engineer approval
- **Hotfixes:** Branch from latest prod tag, expedited review, compliance notified if financial logic changed
- **Feature flags:** LaunchDarkly used for gradual rollouts and A/B tests — new trading features always behind a flag for initial rollout

## Team structure

| Role | Headcount | Responsibilities |
|------|-----------|-----------------|
| PM | 3 (core app, advisory, growth) | Prioritisation, story writing, stakeholder alignment, regulatory liaison |
| iOS | 4 engineers | SwiftUI, KMP integration, App Store releases |
| Android | 4 engineers | Jetpack Compose, KMP, Play Store releases |
| Backend | 6 engineers | NestJS services, exchange integrations, data pipelines |
| Design | 2 designers | UI/UX (bilingual), design system, RTL layout |
| Compliance | 1 embedded (part-time) | Story review, regulatory guidance, audit trail oversight |
| QA | No dedicated QA | Engineers own testing; PM does acceptance on staging |
| On-call | Rotating weekly (4 senior engineers) | PagerDuty, incident response, trading hour coverage |

## Trading hours and on-call

- UAE markets (DFM/ADX): Sunday–Thursday 10:00–14:30 GST
- US markets: Sunday–Friday 16:30–23:00 GST (extended hours 13:30–01:00 GST)
- On-call engineer must be reachable during all market hours — incidents during trading hours are P1 by default
- P1 SLA: acknowledge within 5 minutes, mitigate within 30 minutes

## Estimation

- Story points: Fibonacci 1–8. Combined dev + testing effort per story.
- Stories estimated above 8 must be decomposed before entering a sprint
- Sprint velocity: tracked per squad; updated after each sprint retrospective
- Compliance review stories carry a fixed +1 point overhead for review coordination time
