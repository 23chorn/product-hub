# Phase 3 Implementation Guide: Checkpoint Metadata

## Overview

Added feature progress metadata to checkpoints so the UI can display:
**"Feature 2 of 5: Real-time Message Delivery"**

---

## Changes Made

### 1. **Modified `pauseAtCheckpoint()` signature** (`workflow-router.ts`)

**Before:**
```typescript
export function pauseAtCheckpoint(
  workflowId: string,
  stage: string,
  artifactId?: number,
  sessionId?: string
): CheckpointRow
```

**After:**
```typescript
export function pauseAtCheckpoint(
  workflowId: string,
  stage: string,
  artifactId?: number,
  sessionId?: string,
  metadata?: Record<string, any>  // NEW: optional metadata
): CheckpointRow
```

**Behavior:**
- Merges `metadata` into `coordinator_action` JSON
- Result: `coordinator_action = { session_id, ...metadata }`

### 2. **Added `buildFeatureCheckpointMetadata()`** (`feature-decomposition.ts`)

```typescript
export async function buildFeatureCheckpointMetadata(
  stage: string,
  itemId: string
): Promise<{ 
  featureIndex: number; 
  totalFeatures: number; 
  featureTitle: string 
} | null>
```

**What it does:**
1. Checks if stage matches pattern `story_decomposition_F{N}`
2. Loads `epic_features` artifact
3. Parses feature count and title
4. Returns metadata object or `null` if not a feature stage

**Usage:**
```typescript
const metadata = await buildFeatureCheckpointMetadata(stage, itemId);
// Returns: { featureIndex: 1, totalFeatures: 5, featureTitle: "Real-time Message Delivery" }
```

---

## Integration Point

**Where to call it:** In the autonomous stage runner (`workflowOps.runAutonomousStage` or wherever checkpoints are created after stage completion)

**Pseudocode:**
```typescript
// After stage completes and artifact is saved
const { buildFeatureCheckpointMetadata } = await import('./feature-decomposition');
const featureMetadata = await buildFeatureCheckpointMetadata(stage, itemId);

// Create checkpoint with metadata
pauseAtCheckpoint(workflowId, stage, artifactId, sessionId, featureMetadata ?? undefined);
```

---

## Checkpoint JSON Structure

### Before (regular stage):
```json
{
  "session_id": "sess-abc123"
}
```

### After (feature stage):
```json
{
  "session_id": "sess-abc123",
  "featureIndex": 1,
  "totalFeatures": 5,
  "featureTitle": "Real-time Message Delivery"
}
```

---

## Frontend Integration

### Checkpoint Type (add to shared types)

```typescript
interface CheckpointRow {
  id: number;
  workflow_id: string;
  stage: string;
  artifact_id: number | null;
  status: string;
  human_feedback: string | null;
  coordinator_action: string | null;  // JSON with metadata
  created_at: number;
  resolved_at: number | null;
}

// Parse coordinator_action
const metadata = checkpoint.coordinator_action 
  ? JSON.parse(checkpoint.coordinator_action)
  : {};

if (metadata.featureIndex !== undefined) {
  // This is a feature checkpoint
  const { featureIndex, totalFeatures, featureTitle } = metadata;
  // Display: "Feature 2 of 5: Real-time Message Delivery"
}
```

### UI Display (Checkpoint Panel)

```tsx
{checkpoint.coordinator_action && (() => {
  const meta = JSON.parse(checkpoint.coordinator_action);
  if (meta.featureIndex !== undefined) {
    return (
      <div className="text-xs text-slate-500 dark:text-slate-400 mt-2">
        <span className="font-medium">
          Feature {meta.featureIndex + 1} of {meta.totalFeatures}:
        </span>
        {' '}{meta.featureTitle}
      </div>
    );
  }
  return null;
})()}
```

---

## Testing

1. **Create workflow with 3-feature epic**
2. **Approve `epic_feature_planner`** → system injects F1, F2, F3 stages
3. **Complete F1** → checkpoint created
4. **Query checkpoint:**
   ```sql
   SELECT coordinator_action FROM checkpoints 
   WHERE stage = 'story_decomposition_F1' 
   LIMIT 1;
   ```
5. **Expected result:**
   ```json
   {
     "session_id": "...",
     "featureIndex": 0,
     "totalFeatures": 3,
     "featureTitle": "Real-time Message Delivery"
   }
   ```

---

## Remaining Work

### To Complete Phase 3:

**Task:** Find where `pauseAtCheckpoint()` is called after stages complete and inject feature metadata

**Likely locations:**
- `workflow-stage-runner.ts` → `runAutonomousStage()` after artifact save
- `workflow-router.ts` → wherever checkpoints are created
- `tech-refinement-agent.ts` → after tech refinement completes

**Search pattern:**
```bash
grep -rn "pauseAtCheckpoint\|insertCheckpoint" app/backend/src/agents/
```

**Integration snippet:**
```typescript
// After artifact saved, before checkpoint creation
const { buildFeatureCheckpointMetadata } = await import('./feature-decomposition');
const metadata = await buildFeatureCheckpointMetadata(stage, itemId);

// Option 1: Using pauseAtCheckpoint
pauseAtCheckpoint(workflowId, stage, artifactId, sessionId, metadata ?? undefined);

// Option 2: Using stmts.insertCheckpoint directly
const coordinatorAction = {
  session_id: sessionId,
  ...(metadata ?? {}),
};
stmts.insertCheckpoint.run(
  workflowId, stage, artifactId, 'pending',
  JSON.stringify(coordinatorAction),
  Date.now()
);
```

---

## Next: Phase 4 (UI Polish)

Once metadata is flowing to checkpoints:

1. **Update checkpoint type** in `app/shared/src/types.ts`
2. **Display feature progress** in checkpoint panel
3. **Add feature badges** to stage tracker
4. **Show "Pushed to ADO" indicator** with epic/feature links

---

## Files Modified

1. `app/backend/src/agents/workflow-router.ts`
   - Modified `pauseAtCheckpoint()` to accept metadata parameter

2. `app/backend/src/agents/feature-decomposition.ts`
   - Added `buildFeatureCheckpointMetadata()` helper

---

## Notes

- Metadata is optional — non-feature stages work unchanged
- `null` check prevents errors if artifact is missing
- Frontend parses `coordinator_action` JSON safely (with fallback)
- Feature index is 0-based in backend, 1-based in UI display
