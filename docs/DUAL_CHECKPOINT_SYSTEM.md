# Dual Checkpoint Approval System

## Overview
This document describes the dual-checkpoint approval system for story decomposition stages, where **Stories** and **QA Tests** are reviewed separately but both must be approved before the workflow advances.

## Key Features

### 1. Separate Checkpoints with Independent Approval
- Each feature refinement stage (`story_decomposition_F1`, `story_decomposition_F2`, `story_decomposition_F3`) creates **TWO checkpoints**:
  - **Stories checkpoint** (`story_decomposition_F1`) — requires PM approval
  - **QA Tests checkpoint** (`story_decomposition_F1_qa`) — requires QA approval
- Each checkpoint can be reviewed and approved independently
- Each approval generates its own event log entry

### 2. Grouped Approval Requirement
- The workflow **only advances** when **BOTH checkpoints are approved**
- If stories are approved but QA tests are still pending, the workflow remains paused
- The UI clearly shows the approval state of each checkpoint in the group

### 3. Revision Invalidation
When one checkpoint requests changes while the other is approved:
1. The checkpoint requesting changes is marked as `revised`
2. **All approved checkpoints in the group are automatically invalidated** (marked as `revised`)
3. The stage rolls back and re-runs the full multi-agent refinement
4. Both artifacts (stories JSON and QA tests JSON) are regenerated
5. New checkpoints are created for both, requiring fresh approval

This prevents partial approvals from becoming stale when the underlying work is regenerated.

## Implementation Details

### Backend Changes

#### Workflow Router (`app/backend/src/agents/workflow-router.ts`)
Added helper functions for checkpoint group management:

```typescript
// Get base stage name (strips _qa suffix)
function getBaseStage(stage: string): string

// Get all checkpoints in a group (base + base_qa)
function getCheckpointGroup(workflowId: string, stage: string): CheckpointRow[]

// Check if all checkpoints in group are approved
function isCheckpointGroupFullyApproved(workflowId: string, stage: string): boolean

// Invalidate approved siblings when one is revised
function invalidateCheckpointGroupApprovals(workflowId: string, stage: string, exceptCheckpointId: number): void
```

**Modified `resolveCheckpoint()` function**:
- When a checkpoint is **approved**: checks if all siblings are approved; if yes, sets workflow to `active`; if no, keeps workflow `paused_at_checkpoint`
- When a checkpoint is **revised**: invalidates all approved sibling checkpoints and rolls back the stage
- When a checkpoint is **rejected**: standard rejection flow (marks workflow complete)

#### Checkpoint Resolution Routes (`app/backend/src/routes/workflow-routes.ts`)
Added event log entries for each checkpoint action:
- `checkpoint_approved` — logged when stories OR QA tests are approved (separate events)
- `checkpoint_revised` — logged when stories OR QA tests request changes
- `checkpoint_rejected` — logged when stories OR QA tests are rejected
- `checkpoint_invalidated` — logged when an approved checkpoint is invalidated due to sibling revision

### Frontend Changes

#### CheckpointRow Component (`app/frontend/src/components/workflow/pipeline-terminal/CheckpointRow.tsx`)
Completely rewritten to support dual checkpoint display:

**Single Checkpoint Mode** (legacy stages, non-dual):
- Renders a single approval box with role badge and review button
- Standard approval actions

**Dual Checkpoint Mode** (story decomposition stages):
- Detects when both `story_decomposition_F*` and `story_decomposition_F*_qa` checkpoints exist
- Renders a grouped UI with:
  - Group header showing overall status ("awaiting dual approval", "both approved", etc.)
  - Story checkpoint section with:
    - PM role badge (green if approved, purple if pending)
    - "review →" button to view stories artifact
    - Approval actions (if pending)
    - ✓ approved indicator (if approved)
  - QA checkpoint section with:
    - QA role badge (green if approved, purple if pending)
    - "review →" button to view QA tests artifact
    - Approval actions (if pending)
    - ✓ approved indicator (if approved)
  - Visual indicators: green left border for approved, amber for pending

## User Experience

### Workflow Timeline
When viewing the event log, users see:

```
✓ Multi-agent collaborative refinement complete for Feature 1
⏸ Stories approved by Alice Admin
  [Stories checkpoint still shows as pending for other reviewers until QA also approves]
⏸ QA tests approved by Quinn QA
  [Now both are approved, workflow advances]
✓ Feature 1 stories & test cases pushed to Azure DevOps
```

### Revision Scenario
If QA requests changes after stories are approved:

```
✓ Stories approved by Alice Admin
⚠ Quinn QA requested changes to QA Tests
⚠ story_decomposition_F1 approval invalidated — refinement will regenerate both stories and QA tests
↻ Revision mode: applying targeted changes to Feature 1 stories only…
✓ Multi-agent collaborative refinement complete for Feature 1
⏸ [New checkpoints created — both require fresh approval]
```

### Visual Design
The dual checkpoint UI uses visual hierarchy to make the approval state clear:
- **Group box** with subtle sky-blue background
- **Green left border** on approved checkpoints
- **Amber left border** on pending checkpoints
- **Role badges** change color (purple → green) when approved
- **"Both must be approved to continue"** helper text at the top

## Example Scenarios

### Scenario 1: Sequential Approval (Happy Path)
1. Multi-agent refinement completes for Feature 1
2. PM reviews stories → Approves
3. Workflow remains paused (QA tests still pending)
4. QA reviews test suite → Approves
5. Workflow advances to Feature 2

**Event Log:**
```
stage_completed: Multi-agent collaborative refinement complete for Feature 1
checkpoint_approved: Stories approved by Alice Admin
checkpoint_approved: QA tests approved by Quinn QA
stage_started: Multi-agent collaborative refinement for Feature 2
```

### Scenario 2: Revision After Partial Approval
1. Multi-agent refinement completes for Feature 1
2. PM reviews stories → Approves
3. QA reviews test suite → Requests Revision (missing edge case tests)
4. System invalidates PM's approval
5. Refinement re-runs with QA feedback
6. New artifacts generated
7. Both PM and QA must re-approve

**Event Log:**
```
stage_completed: Multi-agent collaborative refinement complete for Feature 1
checkpoint_approved: Stories approved by Alice Admin
checkpoint_revised: Quinn QA requested changes to QA Tests
checkpoint_invalidated: story_decomposition_F1 approval invalidated — refinement will regenerate both
stage_progress: Revision mode: applying targeted changes to Feature 1 stories only…
stage_completed: Multi-agent collaborative refinement complete for Feature 1
[New checkpoints created]
```

### Scenario 3: Simultaneous Revision Requests
1. Multi-agent refinement completes for Feature 1
2. PM reviews stories → Requests Revision (story F1.S3 acceptance criteria unclear)
3. QA checkpoint remains pending
4. Refinement re-runs with PM feedback
5. New artifacts generated (both stories and QA tests refreshed)
6. New checkpoints created for both

**Event Log:**
```
stage_completed: Multi-agent collaborative refinement complete for Feature 1
checkpoint_revised: Alice Admin requested changes to Stories
stage_progress: Revision mode: applying targeted changes to Feature 1 stories only…
stage_completed: Multi-agent collaborative refinement complete for Feature 1
[New checkpoints created for both stories and QA]
```

## Technical Notes

### Checkpoint Group Detection
Checkpoints are grouped by their base stage name:
- `story_decomposition_F1` and `story_decomposition_F1_qa` are a group
- The `_qa` suffix is stripped to find the base stage
- Both checkpoints share the same logical stage but have different role requirements

### Database Schema
No schema changes were required. The existing `checkpoints` table supports:
- `required_role` — stores role requirement as JSON array
- `status` — `pending`, `approved`, `rejected`, `revised`
- `stage` — stage name (base or base_qa)

### Workflow Status
The workflow `status` field controls advancement:
- `active` — workflow can advance to next stage
- `paused_at_checkpoint` — workflow is waiting for checkpoint approval(s)

The system sets status to `active` only when **all checkpoints in a group** are approved.

## Future Enhancements
- Add a "unified approval" option for admins to approve both checkpoints at once
- Support configurable checkpoint groups (not just stories + QA)
- Add checkpoint dependency chains (e.g., "QA can only approve after PM approves")
- Show approval history in checkpoint details modal
- Add checkpoint approval notifications via Slack/email

## Related Files
- `app/backend/src/agents/workflow-router.ts` — Core checkpoint logic
- `app/backend/src/agents/feature-stage-runner.ts` — Creates dual checkpoints
- `app/backend/src/routes/workflow-routes.ts` — Checkpoint resolution endpoint
- `app/frontend/src/components/workflow/pipeline-terminal/CheckpointRow.tsx` — Dual checkpoint UI
- `db/schema.ts` — Checkpoint table schema
- `db/migrations/0005_qa_role_and_stage_approvals.sql` — QA role migration
