# Feature-by-Feature Story Decomposition Flow

This document describes the complete flow for breaking down features into stories one at a time with human checkpoints and incremental ADO pushes.

## Overview

Instead of generating all stories at once, the system:
1. Creates an epic + features (without stories) in ADO
2. Generates stories for **one feature at a time**
3. Pauses for human approval after each feature
4. Pushes stories to ADO incrementally as each feature is approved
5. Shows accumulated backlog in the UI (all approved features together)

## Step-by-Step Flow

### 1. Epic & Feature Planning (`epic_feature_planner` stage)

**Agent**: Epic Feature Planner (Apex)

**Output**: JSON with epic + 2-8 features (each feature has `stories: []` initially)

**ADO Push**: Immediately after stage completion
- Creates Epic work item
- Creates all Feature work items under the epic (empty, no stories yet)
- Saves mappings in `ado_work_item_map` table

**Example**:
```
Epic: "In-App Messaging & Trade Chat" (#12345)
├─ Feature: "Channel Management" (#12346, 0 stories)
├─ Feature: "Real-time Text Messaging" (#12347, 0 stories)
└─ Feature: "Live Ticker Card Sharing" (#12348, 0 stories)
```

**Checkpoint**: Human reviews epic + features → Approve

---

### 2. Feature Stage Injection (after `epic_feature_planner` approval)

**What happens**: `injectFeatureDecompositionStages()` (feature-decomposition.ts:24) **modifies the workflow's `stage_sequence`** in the database:
- Finds the `story_decomposition` stage in the sequence
- Replaces it with `story_decomposition_F1`, `F2`, `F3`, ... (one per feature)
- Updates the `workflows.stage_sequence` column

Example: 
- **Before**: `["analyst", "pm_prd", "epic_feature_planner", "solution_architect", "story_decomposition", "tech_refinement", "curator"]`
- **After**: `["analyst", "pm_prd", "epic_feature_planner", "solution_architect", "story_decomposition_F1", "story_decomposition_F2", "story_decomposition_F3", "tech_refinement", "curator"]`

Each feature stage will decompose one feature into 6-8 stories.

---

### 3. Story Decomposition for Feature 1 (`story_decomposition_F1`)

**Agent**: Story Decomposition (Shard)

**Input**: 
- Epic/features JSON (from epic_feature_planner)
- PRD (for requirements)
- Architecture doc (for technical context)
- **Only Feature 1** is decomposed this round

**Output**: Full backlog JSON with stories for Feature 1 only
```json
{
  "epic": { ... },
  "features": [
    {
      "title": "Channel Management",
      "stories": [
        { "title": "Browse public channels", "persona": "...", "effort": 2, ... },
        { "title": "Create new channel", "persona": "...", "effort": 3, ... },
        { "title": "Invite members to private channel", "persona": "...", "effort": 2, ... },
        { "title": "Leave channel", "persona": "...", "effort": 1, ... }
      ]
    },
    {
      "title": "Real-time Text Messaging",
      "stories": []  // Not yet decomposed
    },
    {
      "title": "Live Ticker Card Sharing",
      "stories": []  // Not yet decomposed
    }
  ]
}
```

**Artifact**: Saved as type `backlog` (cumulative, will be merged with F2, F3 later)

**Checkpoint**: Human reviews Feature 1 stories → Approve

**ADO Push** (on approval): `pushFeatureToADO(workflowId, featureIndex: 0)`
- Fetches epic ID and feature ID from `ado_work_item_map`
- Creates Story work items under Feature 1
- Updates ADO board:
  ```
  Epic: "In-App Messaging & Trade Chat" (#12345)
  ├─ Feature: "Channel Management" (#12346)
  │  ├─ Story: "Browse public channels" (#12349)
  │  ├─ Story: "Create new channel" (#12350)
  │  ├─ Story: "Invite members to private channel" (#12351)
  │  └─ Story: "Leave channel" (#12352)
  ├─ Feature: "Real-time Text Messaging" (#12347, 0 stories yet)
  └─ Feature: "Live Ticker Card Sharing" (#12348, 0 stories yet)
  ```

---

### 4. Story Decomposition for Feature 2 (`story_decomposition_F2`)

**Agent**: Story Decomposition (Shard)

**Input**: Same as Feature 1, but now decomposing Feature 2

**Output**: Full backlog JSON with stories for Feature 2 merged into the accumulated backlog

**Merge Logic** (`workflow-stage-runner.ts` lines 549-575):
1. Load prior backlog (has stories for F1)
2. Parse new backlog output (has stories for F2)
3. Merge: `prior.features[1].stories = newBacklog.features[1].stories`
4. Save updated cumulative backlog

**Result**: Accumulated backlog now has stories for F1 + F2

**Checkpoint**: Human reviews Feature 2 stories → Approve

**ADO Push** (on approval): `pushFeatureToADO(workflowId, featureIndex: 1)`
- Creates stories under Feature 2
- ADO board now shows F1 + F2 stories

---

### 5. Story Decomposition for Feature 3 (`story_decomposition_F3`)

Same pattern as F2. Accumulated backlog now has stories for F1 + F2 + F3.

---

### 6. Completion

After all features are decomposed and approved:
- Accumulated backlog artifact has **all features with all stories**
- ADO board has **full epic → features → stories hierarchy**
- Workflow advances to next stage (tech_refinement, qa_engineer, or curator)

---

## Key Files

### Backend

| File | Responsibility |
|------|----------------|
| `feature-decomposition.ts:23` | `injectFeatureDecompositionStages()` — replaces `story_decomposition` with `F1`, `F2`, `F3` stages |
| `feature-decomposition.ts:170` | `pushEpicAndFeaturesToADO()` — pushes epic + features (no stories) after epic_feature_planner |
| `feature-decomposition.ts:273` | `pushFeatureToADO()` — pushes stories for one feature after approval |
| `workflow-stage-runner.ts:549` | Feature-specific merge logic — accumulates stories into cumulative backlog |
| `workflow-routes.ts:551` | Checkpoint approval handler — calls `pushFeatureToADO` after each feature approval |
| `artifact-helpers.ts:229` | `loadLatestArtifactContent()` — loads accumulated backlog (latest artifact with type `backlog`) |

### Database

| Table | Purpose |
|-------|---------|
| `ado_work_item_map` | Maps local keys (`F1`, `F1.S1`) to ADO work item IDs for incremental push |
| `artifacts` | Stores cumulative backlog (type `backlog`) — one artifact per feature stage, each is a full merge |

---

## UI Behavior

### Artifact Viewer

When viewing a `story_decomposition_F*` checkpoint:
- Shows the **accumulated backlog** (all approved features + current feature)
- Backlog view renders epic + features with story counts
- User sees progress: "Feature 2 of 5"

### ADO Board Link

After each feature approval:
- "View in Azure DevOps" button appears
- Links to the Epic (shows all features + stories pushed so far)

---

## Benefits of This Approach

✅ **Incremental review** — human only reviews 6-8 stories at a time (not 40+ stories all at once)  
✅ **Incremental push** — stories appear in ADO as soon as approved (devs can start work earlier)  
✅ **Bounded token usage** — each feature decomposition is a separate LLM call (easier to manage)  
✅ **Progressive disclosure** — backlog grows progressively, easier to track progress  
✅ **Failure recovery** — if a feature stage fails, only that feature needs re-generation (not the entire backlog)

---

## Demo Mode Behavior

In demo mode (`demo_mode: 'true`), the system:
1. Uses fixtures for epic_feature_planner (creates epic + 3 features)
2. Injects 3 feature stages: `story_decomposition_F1`, `F2`, `F3`
3. Uses fixtures for each feature stage (pre-built stories)
4. **Human checkpoints are still required** — not auto-approved
5. ADO pushes happen on approval (unless ADO integration is disabled)

---

## Troubleshooting

### "No epic_features artifact found" when pushing to ADO

**Cause**: Artifact not yet saved when `pushEpicAndFeaturesToADO` runs

**Fix**: Already applied — artifact is updated in-place (line 643) before ADO push (line 670)

### Feature stages showing as separate entries in UI

**Current behavior**: Each `story_decomposition_F1`, `F2`, `F3` shows separately

**Expected behavior**: Single "Story Decomposition" entry with feature progress shown in event log

**Status**: Frontend Proxy already maps all `story_decomposition_F*` to "Story Decomposition — Shard" (see `stage-labels.ts`)

### Accumulated backlog not showing in UI

**Check**:
1. Artifact type is `backlog` (✓ confirmed in `stage-metadata.ts`)
2. UI loads latest artifact by type (✓ `loadLatestArtifactContent` orders by `created_at DESC`)
3. Merge logic is preserving prior stories (✓ lines 549-575)

---

## Future Enhancements

### 1. Show Feature Progress in UI
Add checkpoint metadata to show "Feature 2 of 5" in the approval dialog.

**Implementation**: `buildFeatureCheckpointMetadata()` already exists (feature-decomposition.ts:124)

### 2. Collapse Feature Stages in UI
Show single "Story Decomposition" entry with expandable feature details.

**Implementation**: Frontend can group by stage name pattern (`story_decomposition_F*`)

### 3. Parallel Feature Decomposition
Allow multiple features to be decomposed in parallel by different team members.

**Implementation**: Would require separate checkpoints per feature + merge conflict resolution

---

## Configuration

No configuration needed — feature-by-feature flow is the **default** when `epic_feature_planner` is enabled in the stage sequence.

To disable (revert to all-at-once):
1. Remove `story_decomposition` from stage sequence
2. Use `pm_backlog` instead (DEPRECATED but still functional)
