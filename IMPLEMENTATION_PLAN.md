# Feature-by-Feature Story Decomposition Implementation Plan

## Problem
Currently `story_decomposition` processes all features at once, which:
- Can hit token limits for large epics
- Pushes all stories to ADO at once without granular control
- No human review between features

## Proposed Solution
Break `story_decomposition` into **per-feature sub-stages** with checkpoints after each feature's stories are generated.

---

## Architecture

### Option A: Dynamic Sub-Stages (Recommended)

**Flow:**
1. `epic_feature_planner` completes → checkpoint
2. User approves epic/features → workflow reads feature count from the artifact
3. For each feature (F1, F2, F3...):
   - Create dynamic stage name: `story_decomposition_F1`, `story_decomposition_F2`, etc.
   - Run specialist with context: "Decompose ONLY Feature 1 into 6-8 stories"
   - Save partial backlog artifact (epic + features[0..i] with stories)
   - Create checkpoint
   - User reviews → approve/revise/reject
   - On approve: optionally push THIS feature's stories to ADO immediately
4. After all features approved → proceed to `tech_refinement` (reads full backlog)

**Pros:**
- Bounded token usage per run (one feature = ~6-8 stories)
- Incremental ADO push (can create epic + F1 stories, then add F2, etc.)
- Human review at feature boundaries
- Natural pause points if user wants to adjust scope

**Cons:**
- More complex workflow state machine
- Stage sequence is dynamic (can't pre-determine)
- Need to accumulate partial artifacts across stages

**Implementation:**
- Modify `workflow-router.ts` → after `epic_feature_planner` approval, read artifact, inject `story_decomposition_F{N}` stages dynamically
- Modify `workflow-stage-runner.ts` → detect `story_decomposition_F{N}` pattern, load prior feature stories + current feature metadata
- New helper: `loadPartialBacklog(itemId)` → reads latest backlog artifact (may be incomplete)
- Modify ADO push logic → accept `featureIndex` param to push incrementally

---

### Option B: Batch with Manual Feature Review

**Flow:**
1. `story_decomposition` runs once, outputs ALL features with stories
2. Checkpoint created with feature-level metadata
3. UI shows expandable feature list → user approves feature-by-feature
4. Only approved features are pushed to ADO

**Pros:**
- Simpler workflow (one stage, one checkpoint)
- Specialist sees full context (all features) for consistency
- No dynamic stage injection

**Cons:**
- Still risks token limits for large epics (10+ features)
- No opportunity to revise individual features without re-running all

**Implementation:**
- Checkpoint metadata includes: `{ featuresReviewed: { F1: 'approved', F2: 'pending', F3: 'revised' } }`
- UI update: checkpoint review shows feature-by-feature approve/revise buttons
- Revision triggers a new `story_decomposition` run with context: "Revise Feature 2 only, preserve all others"

---

## Recommendation: **Option A** (Dynamic Sub-Stages)

Reasoning:
- Most aligned with the user's goal of bounded outputs and phased ADO push
- Scales to any epic size without token concerns
- Clear, atomic work units (one feature = one checkpoint)

---

## Implementation Steps (Option A)

### Phase 1: Feature Count Detection & Stage Injection

**File:** `workflow-router.ts` → `advanceStage()`

After `epic_feature_planner` checkpoint is approved:
1. Read the `epic_features` artifact
2. Parse JSON → count features
3. Inject `story_decomposition_F1`, `story_decomposition_F2`, ..., `story_decomposition_FN` into `stage_sequence`
4. Log event: "Detected N features — will decompose one at a time"

**Pseudocode:**
```typescript
if (justCompletedStage === 'epic_feature_planner' && checkpointApproved) {
  const epicFeaturesArtifact = await loadLatestArtifactContent(itemId, 'epic_features');
  const parsed = JSON.parse(epicFeaturesArtifact);
  const featureCount = parsed.features.length;
  
  // Find position of 'story_decomposition' in sequence (if present)
  const storyDecompIndex = workflow.stage_sequence.indexOf('story_decomposition');
  if (storyDecompIndex >= 0) {
    // Replace with feature-specific stages
    const beforeStages = workflow.stage_sequence.slice(0, storyDecompIndex);
    const afterStages = workflow.stage_sequence.slice(storyDecompIndex + 1);
    const featureStages = Array.from({ length: featureCount }, (_, i) => `story_decomposition_F${i + 1}`);
    const newSequence = [...beforeStages, ...featureStages, ...afterStages];
    
    db.prepare('UPDATE workflows SET stage_sequence = ? WHERE id = ?')
      .run(JSON.stringify(newSequence), workflowId);
    
    logger.info(`Injected ${featureCount} feature-specific story decomposition stages`);
  }
}
```

### Phase 2: Feature-Specific Stage Handling

**File:** `workflow-stage-runner.ts` → `runAutonomousStage()`

Detect pattern `story_decomposition_F{N}`:
```typescript
const featureMatch = stage.match(/^story_decomposition_F(\d+)$/);
if (featureMatch) {
  const featureIndex = parseInt(featureMatch[1], 10) - 1; // 0-indexed
  
  // Load prior partial backlog (if exists)
  const priorBacklog = await loadPartialBacklog(itemId);
  
  // Load epic/features from epic_feature_planner
  const epicFeaturesContent = await loadLatestArtifactContent(itemId, 'epic_features');
  const epicFeatures = JSON.parse(epicFeaturesContent);
  const targetFeature = epicFeatures.features[featureIndex];
  
  // Build context: "Decompose ONLY this feature"
  itemContext = `
**PRD Document:**
${await loadLatestArtifactContent(itemId, 'prd')}

**Architecture Document:**
${await loadLatestArtifactContent(itemId, 'architecture')}

**Epic & Features:**
${epicFeaturesContent}

**YOUR TASK:**
Decompose ONLY the following feature into 6-8 stories. Do NOT decompose other features.

Feature to decompose: ${targetFeature.title}
Phase: ${targetFeature.phase}
Description: ${targetFeature.description}

**Output format:**
Return the FULL backlog JSON structure (epic + all features), but only populate stories for Feature ${featureIndex + 1}. 
For other features, include them but leave stories: [].

${priorBacklog ? `**Prior work (preserve these):**\n${priorBacklog}` : ''}
`;
}
```

**Helper function:**
```typescript
async function loadPartialBacklog(itemId: string): Promise<string | null> {
  // Load the latest backlog artifact (may be incomplete)
  const artifact = db.prepare(`
    SELECT a.file_path FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND a.type = 'backlog'
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId);
  
  if (!artifact) return null;
  return fs.readFileSync(resolveArtifactPath(artifact.file_path), 'utf-8');
}
```

### Phase 3: Incremental Artifact Accumulation

After each `story_decomposition_F{N}` stage completes:
1. Parse the output JSON
2. Merge with prior backlog (if exists)
3. Save the accumulated backlog as a new artifact
4. Checkpoint metadata includes: `{ featureIndex: N, totalFeatures: M }`

**Pseudocode:**
```typescript
if (featureMatch) {
  const newBacklog = JSON.parse(artifactContent);
  const priorBacklog = await loadPartialBacklog(itemId);
  
  if (priorBacklog) {
    const prior = JSON.parse(priorBacklog);
    // Merge: copy stories from new into the cumulative structure
    for (let i = 0; i < prior.features.length; i++) {
      if (newBacklog.features[i].stories.length > 0) {
        prior.features[i].stories = newBacklog.features[i].stories;
      }
    }
    artifactContent = JSON.stringify(prior, null, 2);
  }
  
  // Save accumulated backlog
  await saveLocalArtifact(sessionId, 'backlog', artifactContent, itemId);
  
  // Checkpoint metadata
  checkpointMetadata = {
    featureIndex,
    totalFeatures: epicFeatures.features.length,
    featureTitle: targetFeature.title,
  };
}
```

### Phase 4: Incremental ADO Push

After checkpoint approval, push THIS feature's stories to ADO.

**File:** `workflow-router.ts` → checkpoint resolve handler

```typescript
if (justApprovedStage.startsWith('story_decomposition_F')) {
  const featureMatch = justApprovedStage.match(/^story_decomposition_F(\d+)$/);
  const featureIndex = parseInt(featureMatch[1], 10) - 1;
  
  // Load accumulated backlog
  const backlog = JSON.parse(await loadLatestArtifactContent(itemId, 'backlog'));
  
  // Push to ADO incrementally
  if (appConfig.integrations.workItems === 'ado') {
    const { AzureDevOpsClient } = require('../integrations/azure-devops');
    const client = new AzureDevOpsClient();
    
    if (featureIndex === 0) {
      // First feature: create epic + first feature
      await client.createEpicAndFeature(backlog.epic, backlog.features[0]);
    } else {
      // Subsequent features: add to existing epic
      await client.addFeatureToEpic(existingEpicId, backlog.features[featureIndex]);
    }
  }
}
```

### Phase 5: UI Updates

**Checkpoint display:**
- Show feature progress: "Story Decomposition — Feature 2 of 5: Real-time Message Delivery"
- Approval advances to next feature
- Final feature approval proceeds to next stage (tech_refinement)

**File:** `components/workflow/InlineCheckpointActions.tsx`

Add feature progress indicator when checkpoint metadata includes `featureIndex`:
```tsx
{checkpoint.metadata?.featureIndex !== undefined && (
  <div className="text-xs text-slate-500 mt-1">
    Feature {checkpoint.metadata.featureIndex + 1} of {checkpoint.metadata.totalFeatures}: 
    {checkpoint.metadata.featureTitle}
  </div>
)}
```

---

## Migration Strategy

- New workflows use dynamic feature stages
- Old workflows with `story_decomposition` (non-dynamic) still work as before
- No breaking changes to existing completed workflows

---

## Testing Plan

1. Small epic (2 features) → verify both feature stages run, checkpoints created, ADO pushes incrementally
2. Large epic (6 features) → verify no token limits hit, all features decomposed correctly
3. Revision mid-flow → approve F1, revise F2 → verify F2 re-runs, F1 preserved
4. Cancel mid-flow → approve F1, cancel workflow → verify partial backlog saved

---

## Estimated Effort

- Phase 1 (stage injection): 2-3 hours
- Phase 2 (feature-specific context): 2 hours
- Phase 3 (artifact accumulation): 2 hours
- Phase 4 (incremental ADO push): 3 hours
- Phase 5 (UI updates): 1-2 hours
- Testing: 2-3 hours

**Total: ~12-15 hours**

---

## Next Steps

1. Implement Phase 1 (stage injection after epic_feature_planner approval)
2. Test with a 2-feature epic end-to-end
3. Implement Phases 2-3 (feature-specific decomposition + accumulation)
4. Implement Phase 4 (incremental ADO push)
5. Polish UI (Phase 5)
6. Full regression test on demo webhook flow
