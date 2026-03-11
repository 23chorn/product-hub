# Development Process

> **How to use this file:** Copy to `process.md`, fill in your real details, and delete this note.
> `process.md` is gitignored — your process details stay local. This example uses a fictional company.

## Sprint cadence

- **Length:** 2-week sprints, Monday to Friday
- **Planning:** Monday morning of sprint start (1 hour)
- **Standup:** Daily async in Slack (#eng-standup) by 10 AM local time
- **Review:** Friday of sprint end — demo to stakeholders (30 min)
- **Retro:** Friday of sprint end — team only (45 min)

## Definition of Ready

A story is ready for sprint when:
- Acceptance criteria are written and reviewed by the PM
- Design mockups attached (if UI work)
- Dependencies identified and unblocked
- Estimated by at least 2 engineers
- No open questions tagged `needs-clarification`

## Definition of Done

A story is done when:
- Code is merged to `main` via approved PR (1 reviewer minimum)
- Unit tests pass, integration tests pass if applicable
- Deployed to `staging` and smoke-tested
- Documentation updated if user-facing behavior changed
- PM has verified acceptance criteria on staging

## Branching and release

- **Branch naming:** `feature/TICKET-123-short-description`, `fix/TICKET-456-bug-name`
- **PR rules:** Squash merge only, linked to ticket, CI must pass
- **Staging:** Auto-deploys on merge to `main`
- **Production:** Manual promote from staging — any engineer can trigger, but requires Slack confirmation in #releases
- **Hotfixes:** Branch from latest prod tag, cherry-pick fix, fast-track PR review

## Team roles

| Role | Who | Responsibilities |
|------|-----|-----------------|
| PM | 2 PMs, split by product area | Prioritization, story writing, stakeholder alignment |
| Engineering | 8 engineers (4 frontend, 4 backend) | Implementation, code review, on-call |
| Design | 1 designer | UI/UX mockups, design system maintenance |
| QA | No dedicated QA | Engineers own testing; PM does acceptance |
| On-call | Rotating weekly among 4 senior engineers | PagerDuty alerts, incident response |

## Estimation

- Story points: 1 (trivial), 2 (small), 3 (medium), 5 (large), 8 (too big — split it)
- Velocity target: 30–35 points per sprint
- Anything estimated at 8+ must be broken down before entering a sprint
