# @xcube/pipeline

Developer onboarding CLI — pulls initiative context from Product Hub and launches Claude Code for implementation.

## What it does

`pipeline run` performs four steps in sequence:

1. **Fetches the initiative manifest** from Product Hub (`/api/dev/initiatives/:n/manifest`) — filtered to your platform stream and phase. Returns the initiative context, feature list, and a topologically-sorted implementation order.
2. **Fetches full ticket payloads** (`/api/dev/initiatives/:n/tickets/payload`) — acceptance criteria, technical ACs, resolved FRs/NFRs, platform notes, dependencies.
3. **Writes two files** into your workspace:
   - `PIPELINE_CONTEXT.md` — full initiative context and every ticket's details
   - `PIPELINE_PLAN.md` — ordered checklist of tickets to implement, with checkboxes
4. **Moves tickets** from "New" → "In Dev" in Azure DevOps (best-effort; continues on failure).

Then it launches Claude Code in interactive or headless mode, seeded with the context files and a system prompt that tells it to work through the plan in order.

## Prerequisites

- Node.js 18+
- [`claude` CLI](https://claude.ai/code) installed globally
- A running Product Hub instance with `PIPELINE_API_KEY` set in its `.env`

## Installation

```bash
npm install -g @xcube/pipeline
```

Or run directly:

```bash
npx @xcube/pipeline run --init=21 --phase=mvp --stream=backend
```

## Configuration

Create a `.env` file in `packages/pipeline/` (or set environment variables):

```bash
PIPELINE_API_URL=http://your-product-hub-host:3001
PIPELINE_API_KEY=your-api-key-here
```

The API key must match `PIPELINE_API_KEY` set in the Product Hub server's `.env`.

Generate a key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Usage

```bash
pipeline run --init <n> --phase <name> --stream <name> [options]
```

| Option | Required | Description |
|--------|----------|-------------|
| `--init <n>` | yes | Initiative sequence number (the `#N` shown on the card in Product Hub) |
| `--phase <name>` | yes | Phase to filter tickets by — must match the phase label used in the backlog (e.g. `mvp`, `v2`, `phase 2`) |
| `--stream <name>` | yes | Platform stream: `backend`, `web`, `ios`, or `android` |
| `--mode <mode>` | no | `interactive` (default) or `headless` |
| `--api <url>` | no | Override `PIPELINE_API_URL` |
| `--key <key>` | no | Override `PIPELINE_API_KEY` |
| `--workspace <path>` | no | Directory to write context files and launch Claude Code in (default: cwd) |

### Example

```bash
pipeline run --init=21 --phase=mvp --stream=ios
```

## Streams

The `--stream` flag filters which tickets are included:

| Stream | Matches |
|--------|---------|
| `backend` | Stories tagged `platform: ["backend"]` |
| `web` | Stories tagged `platform: ["web"]` |
| `ios` | Stories tagged `platform: ["ios"]` |
| `android` | Stories tagged `platform: ["android"]` |

Stories tagged for multiple platforms appear in each relevant stream. Cross-stream dependencies (a story that depends on a ticket in another stream) surface in `blockedTickets` — they are excluded from `implementationOrder` until the dependency is resolved.

## Output files

`PIPELINE_CONTEXT.md` is the reference document — initiative context (problem statement, users, metrics, constraints) plus every ticket's full details (user story, acceptance criteria, technical ACs, resolved FRs/NFRs, platform notes).

`PIPELINE_PLAN.md` is the checklist:

```markdown
# Initiative #21: Add Price Alerts
## Status: 0 / 5 complete

- [ ] F0.S0 — Poll external price APIs on configurable intervals
- [ ] F0.S1 — Cache price data in Redis with TTL
- [ ] F0.S2 — Detect price threshold breaches and emit events
- [ ] F1.S0 — Integrate with APNS for iOS push delivery
- [ ] F1.S1 — Add iOS UI for alert threshold configuration
```

Claude Code marks each ticket `[x]` as it completes it.

## Modes

### Interactive (default)

Launches `claude` in interactive mode. Claude Code reads `PIPELINE_PLAN.md`, implements the first unchecked ticket, marks it done, and proceeds. You stay in the loop.

### Headless

```bash
pipeline run --init=21 --phase=mvp --stream=backend --mode=headless
```

Launches `claude -p <prompt>` — non-interactive, runs to completion. Useful for CI or automated dev environments.

## Building from source

```bash
cd packages/pipeline
npm install
npm run build      # tsc → dist/
npm run dev        # ts-node for local dev without build step
```

The package is separate from the main app workspaces — it has its own `tsconfig.json` and is not listed in the root `package.json` workspaces.
