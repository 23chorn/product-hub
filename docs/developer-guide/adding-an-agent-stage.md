# Developer Guide: Adding a New Agent Stage

This guide walks through every file that needs to be created or modified to add a new specialist stage to the coordinator-driven workflow pipeline. A worked example — the **Localisation Review** stage — is used throughout.

---

## Overview

A stage is a named step in the workflow sequence (e.g. `analyst`, `pm_prd`, `critic`). Each stage either:

- **Creates a BMAD specialist session** (interactive, pauses at a checkpoint for human review), or
- **Runs an autonomous agent** (single-shot LLM call, no interactive session — like `critic` and `curator`)

This guide covers both patterns.

---

## Step 1 — Choose a stage name

Stage names are lowercase, using underscores. They must be registered in several places, so keep the name short and unique.

For the worked example: `l10n_review` (localisation review).

---

## Step 2 — Create the persona file

Create a plain markdown file in `agents/personas/`. This is the agent's system prompt header — not BMAD XML, just markdown.

**`agents/personas/l10n_review.md`**

```markdown
# Localisation Review Agent

You are a specialist in software localisation and internationalisation (l10n/i18n).
Your role is to review product artifacts for localisation readiness — identifying
assumptions about language, locale, date/number formats, RTL text, and cultural context
that may not transfer across markets.

## Rules
- Only raise issues that are directly evidenced in the artifact provided.
- Prefix every issue with a severity: [BLOCKER], [MAJOR], or [MINOR].
- Be specific: cite the exact requirement or section that has the issue.
- Do not speculate about markets not mentioned in the goal.
```

Keep persona files concise. The stage brief (injected as the first user message) carries the goal-specific context.

---

## Step 3 — Create the agent module

Create a new file in `app/backend/src/agents/`. The pattern depends on whether this is an autonomous stage or an interactive one.

### Option A: Autonomous agent (runs without human interaction mid-flow)

Follow the `CriticAgent` pattern in `critic-agent.ts`.

**`app/backend/src/agents/l10n-review-agent.ts`**

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { streamAI, resolveModelId } from '../utils/ai-provider';
import Logger from '../utils/logger';

const logger = new Logger('L10N-REVIEW');
const PERSONA_PATH = path.resolve(__dirname, '../../../../agents/personas/l10n_review.md');

export interface L10nIssue {
  severity: 'blocker' | 'major' | 'minor';
  description: string;
}

export interface L10nReview {
  verdict: 'approve' | 'revise';
  issues: L10nIssue[];
  summary: string;
}

export class L10nReviewAgent {
  private readonly persona: string;

  constructor() {
    this.persona = fs.readFileSync(PERSONA_PATH, 'utf-8');
    logger.info('L10n Review persona loaded');
  }

  async review(artifactContent: string, artifactType: string, model?: string): Promise<L10nReview> {
    const resolvedModel = resolveModelId(model);
    const userMessage = [
      `Review the following ${artifactType} for localisation readiness.`,
      '',
      artifactContent,
    ].join('\n');

    let fullResponse = '';
    for await (const chunk of streamAI(resolvedModel, this.persona, [{ role: 'user', content: userMessage }])) {
      fullResponse += chunk;
    }

    return this.parseReview(fullResponse);
  }

  private parseReview(text: string): L10nReview {
    const issues: L10nIssue[] = [];
    for (const line of text.split('\n')) {
      if (line.includes('[BLOCKER]')) issues.push({ severity: 'blocker', description: line.replace(/\[BLOCKER\]/i, '').trim() });
      else if (line.includes('[MAJOR]'))   issues.push({ severity: 'major',   description: line.replace(/\[MAJOR\]/i, '').trim() });
      else if (line.includes('[MINOR]'))   issues.push({ severity: 'minor',   description: line.replace(/\[MINOR\]/i, '').trim() });
    }

    const hasBlocker = issues.some(i => i.severity === 'blocker');
    return {
      verdict: hasBlocker ? 'revise' : 'approve',
      issues,
      summary: text.slice(0, 300),
    };
  }
}
```

### Option B: Interactive BMAD specialist session

If the stage should open a chat session (like `analyst` or `pm_prd`), you don't need a new agent class. The `BmadAgent` in `bmad-agent.ts` is reused. Skip to Step 4 and add the stage to `STAGE_SESSION_MAP` pointing at an existing mode.

---

## Step 4 — Register the stage in `workflow-router.ts`

Open `app/backend/src/agents/workflow-router.ts`. Make three additions:

### 4a — Add to `STAGE_SESSION_MAP`

This maps the stage name to a BMAD session mode. For autonomous stages (Option A above), the mapping is still needed as a fallback but won't be used by the main flow.

```typescript
const STAGE_SESSION_MAP: Record<string, { mode: AppMode; agentType: AgentType }> = {
  analyst:    { mode: 'analyst', agentType: 'analyst' },
  pm_prd:     { mode: 'prd',     agentType: 'pm' },
  pm_backlog: { mode: 'backlog', agentType: 'pm' },
  critic:     { mode: 'analyst', agentType: 'analyst' },
  curator:    { mode: 'analyst', agentType: 'analyst' },
  l10n_review: { mode: 'analyst', agentType: 'analyst' }, // <-- add this
};
```

### 4b — Add a lazy singleton (autonomous stages only)

```typescript
import { L10nReviewAgent } from './l10n-review-agent';

let _l10nReview: L10nReviewAgent | null = null;
function getL10nReview(): L10nReviewAgent {
  if (!_l10nReview) _l10nReview = new L10nReviewAgent();
  return _l10nReview;
}
```

### 4c — Add a branch in `advanceStage()`

Inside `advanceStage()`, before the `// ── Regular specialist stage` block, add:

```typescript
// ── Localisation Review stage: automated single-shot review ──────────────
if (nextStage === 'l10n_review') {
  const { content: artifactContent, type: artifactType } = loadLatestArtifactForItem(workflow.item_id);
  const review = await getL10nReview().review(artifactContent, artifactType);

  const coordinatorAction = JSON.stringify({
    l10n_verdict: review.verdict,
    issue_count: review.issues.length,
    blocker_issues: review.issues.filter(i => i.severity === 'blocker').length,
    auto_reviewed: true,
  });

  stmts.insertCheckpoint.run(workflowId, nextStage, null, 'pending', coordinatorAction, now);
  stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);

  logger.info(`L10n Review completed for workflow ${workflowId} — verdict: ${review.verdict}`);
  return { stage: nextStage, sessionId: null };
}
```

---

## Step 5 — Add the output format specification to `coordinator-agent.ts`

Open `app/backend/src/agents/coordinator-agent.ts`. Add an entry to `STAGE_OUTPUT_FORMATS`:

```typescript
const STAGE_OUTPUT_FORMATS: Record<string, { label: string; format: string }> = {
  // ... existing entries ...

  l10n_review: {
    label: 'Localisation Review',
    format: `Produce a localisation readiness review in markdown with these sections:

## Summary
One paragraph verdict: is the artifact localisation-ready, or must it be revised?

## Issues
Bullet list. Prefix each with severity: [BLOCKER], [MAJOR], or [MINOR].
A BLOCKER indicates a hard requirement that prevents launch in any non-English locale.

## Recommendations
Concrete, specific changes required. Each recommendation must cite the section or
requirement it applies to.`,
  },
};
```

This format is injected into `generateStageBrief()` when the Coordinator briefs the L10n agent.

---

## Step 6 — Register the stage name in `workflow-routes.ts`

Open `app/backend/src/routes/workflow-routes.ts`. Add the new stage name to `KNOWN_STAGES`:

```typescript
const KNOWN_STAGES = new Set(['analyst', 'pm_prd', 'pm_backlog', 'critic', 'curator', 'l10n_review']);
```

This ensures `validateStageSequence()` accepts `l10n_review` when the Coordinator includes it in its stage plan.

---

## Step 7 — Add the stage label to the frontend stage tracker

Open `app/frontend/src/components/WorkflowStageTracker.tsx`. Add to `STAGE_LABELS`:

```typescript
const STAGE_LABELS: Record<string, string> = {
  analyst:     'Analyst',
  pm_prd:      'PM — PRD',
  pm_backlog:  'PM — Backlog',
  critic:      'Critic',
  curator:     'Curator',
  l10n_review: 'Localisation Review', // <-- add this
};
```

Also add the same label to `CheckpointPanel.tsx`:

```typescript
const STAGE_LABELS: Record<string, string> = {
  analyst:     'Analyst Research',
  pm_prd:      'Product Requirements Document',
  pm_backlog:  'Backlog',
  critic:      'Critic Review',
  curator:     'Context Curation',
  l10n_review: 'Localisation Review', // <-- add this
};
```

---

## Step 8 — Update the Coordinator persona

Open `agents/personas/coordinator.md`. Add the new stage to the list of available stages so the Coordinator knows it exists and when to include it:

```markdown
- l10n_review — localisation readiness review; include when the goal targets multiple
                languages, locales, or markets outside a single country
```

---

## Checklist

| Step | File | What to do |
|------|------|------------|
| 1 | `agents/personas/l10n_review.md` | Create persona markdown |
| 2 | `agents/l10n-review-agent.ts` | Create agent class (autonomous) or skip (interactive BMAD) |
| 3a | `agents/workflow-router.ts` | Add to `STAGE_SESSION_MAP` |
| 3b | `agents/workflow-router.ts` | Add lazy singleton and import |
| 3c | `agents/workflow-router.ts` | Add branch in `advanceStage()` |
| 4 | `agents/coordinator-agent.ts` | Add to `STAGE_OUTPUT_FORMATS` |
| 5 | `routes/workflow-routes.ts` | Add to `KNOWN_STAGES` |
| 6a | `components/WorkflowStageTracker.tsx` | Add to `STAGE_LABELS` |
| 6b | `components/CheckpointPanel.tsx` | Add to `STAGE_LABELS` |
| 7 | `agents/personas/coordinator.md` | Document the stage for the Coordinator |

---

## The `STAGE_OUTPUT_FORMATS` Config Object

`STAGE_OUTPUT_FORMATS` in `coordinator-agent.ts` is the source of truth for what each stage must produce. The shape for each entry:

```typescript
interface StageOutputFormat {
  label: string;    // Human-readable name used in stage briefs and logs
  format: string;   // Full markdown prompt injected under "## Required Output Format"
                    // in the stage brief. Should specify exact sections, structure,
                    // and constraints (max word counts, required fields, etc.)
}
```

**Design rules for `format`:**
- Be prescriptive. Vague format specs produce vague outputs.
- Include hard constraints: max word counts, required section names, forbidden content.
- For structured data (JSON, YAML), include the exact schema with a concrete example.
- Keep the format string under ~800 tokens (~3200 characters) — it's injected inside a larger prompt.
- If the format requires the agent to reference previous stage output, note it explicitly: `"Using the PRD provided above, produce a backlog..."`.

**Where it's used:**
`generateStageBrief(workflowId, stage, previousOutputSummary?)` reads this config and injects it as the `## Required Output Format` section of the handoff brief that becomes the first user message in the specialist's session.

---

## Adding an Interactive Stage (Option B in detail)

If the new stage should open an interactive BMAD chat session (like `pm_prd` or `analyst`), the flow is:

1. Skip creating a new agent class (Steps 2 and 3b/3c are not needed).
2. Add the stage to `STAGE_SESSION_MAP` pointing at an existing mode (`analyst`, `prd`, or `backlog`).
3. The `advanceStage()` function's regular specialist block handles it automatically — it creates a BMAD session using the mapped mode and pauses at a checkpoint.
4. Still add `STAGE_OUTPUT_FORMATS`, `KNOWN_STAGES`, frontend labels, and Coordinator persona documentation.

The specialist session is driven by the existing `ChatInterface` / `bmad-routes.ts` flow — the user opens the session via the BMAD chat and the Coordinator-generated stage brief is injected as the first message.
