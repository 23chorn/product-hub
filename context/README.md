# Project Context Files

Files in this directory are injected into every agent's system prompt under the `## Project & Company Context` heading. They give agents persistent background knowledge about your product so they don't ask for information you've already documented.

## How it works

- All `.md` files in this directory are concatenated and injected automatically — no code changes needed to add a new file
- Files are cached in memory and the cache is invalidated automatically when files are saved via the UI or when context diffs are approved — **no restart needed**
- There is no enforced length limit per file, but keep each file focused — unnecessary content adds to input tokens on every request

## Editing context files

**From the UI (recommended):** Click the **Context** button in the app header to open the Context Editor. All 6 canonical files are shown. Files with templates have a "Load template" button when empty. Changes are saved immediately and picked up by the next agent request.

**From disk:** Edit files directly in this directory. The cache is invalidated automatically when the Context Curator approves diffs, or when the UI saves a file. If editing on disk outside those flows, restart the backend to pick up changes.

Example files (`*.example.md`) are tracked in git as templates. Your actual context files are gitignored so company-specific content stays off the repo.

## Active files

### `company.md` *(gitignored — copy from company.example.md)*
Company overview injected into every session. Covers:
- Mission & vision
- Products and platforms
- Target user segments
- Market and competitive position
- Key differentiators
- Business model overview

### `strategy.md` *(gitignored — copy from strategy.example.md)*
Strategic direction for the product. Covers:
- North star goal / vision
- Current OKRs or key results
- Roadmap themes and focus areas
- Explicit non-priorities (what you are intentionally NOT doing)
- Constraints (budget, timeline, regulatory)

## Recommended additional files

Create any of the following to expand agent knowledge. They are picked up automatically once saved.

### `tech-stack.md` *(create to enable)*
Technical context for the product being built. Suggested sections:
```markdown
## Frontend
[Framework, state management, styling, key libraries]

## Backend
[Language/runtime, framework, API style, authentication]

## Infrastructure
[Hosting, CI/CD, environments, deployment process]

## Key integrations
[Third-party APIs, data providers, payment systems, etc.]
```

### `db-schema.md` *(create to enable)*
Database schema reference. Helps agents reason about data models and avoid proposing changes that conflict with existing structures. Suggested format:
```markdown
## Tables

### users
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| email | varchar | Unique |

### [other tables...]

## Key relationships
[Describe important FKs and join patterns]
```

### `process.md` *(create to enable)*
Development and delivery process. Suggested sections:
```markdown
## Sprint / iteration cadence
[Length, ceremonies, rituals]

## Definition of Ready
[What must be true before a story enters a sprint]

## Definition of Done
[What must be true before a story is considered complete]

## Release process
[Branching strategy, environments, approval gates]

## Team roles
[Who does what — PM, dev, QA, design]
```

### `current-state.md` *(create to enable)*
A snapshot of where things stand right now. Update this periodically as the project evolves. Suggested sections:
```markdown
## What is live today
[Features that are shipped and in production]

## Active work
[What is currently in progress / this sprint]

## Known debt and issues
[Technical debt, known bugs, deferred items]

## Recent decisions
[Major decisions made in the last few weeks that affect upcoming work]
```

## Tips

- **Be specific.** Vague entries ("we care about performance") add tokens without helping the agent. Specific entries ("p95 API latency target is 200 ms") let agents make concrete recommendations.
- **Keep facts, not opinions.** The agent already knows product best practices. Use context files to supply facts it can't know otherwise.
- **Avoid duplication.** If something is covered in `company.md`, don't repeat it in `strategy.md`. Duplicate content inflates input tokens.
- **Update `current-state.md` regularly.** It has the shortest shelf life of all context files. Stale state descriptions actively mislead agents.
