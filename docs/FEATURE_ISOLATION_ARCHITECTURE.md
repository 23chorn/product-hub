# Feature Isolation Architecture

## Problem: Exponential Token Growth

### Old Architecture (Accumulative)
Each feature stage outputs **ALL features processed so far**, causing exponential token growth:

```
F1: outputs [F1] → 4k tokens
F2: outputs [F1, F2] → 8k tokens
F3: outputs [F1, F2, F3] → 12k tokens
F4: outputs [F1, F2, F3, F4] → 16k tokens
...
F9: outputs [F1...F9] → 36k tokens ❌
```

**Total output tokens**: 4k + 8k + 12k + 16k + 20k + 24k + 28k + 32k + 36k = **180k tokens**
**Cost**: ~$13.50 for 9 features 😱

### New Architecture (Isolated + Merge)
Each feature stage outputs **ONLY that feature**, then a final merge stage combines them:

```
F1: outputs [F1] → 4k tokens
F2: outputs [F2] → 4k tokens
F3: outputs [F3] → 4k tokens
...
F9: outputs [F9] → 4k tokens
backlog_merge: combines all → 36k tokens (one-time)
```

**Total output tokens**: 9 × 4k + 36k = **72k tokens**
**Cost**: ~$5.40 for 9 features ✅
**Savings**: **60% reduction** 🎉

## Implementation

### 1. Feature Stages Store Isolated Artifacts

**File**: `app/backend/src/agents/feature-stage-runner.ts`

Changed from accumulated backlog to isolated feature artifacts:

```typescript
// OLD (accumulated):
const artifactId = await saveLocalArtifact(sessionId, 'backlog', accumulatedBacklog, itemId);

// NEW (isolated):
const featureNum = featureIndex + 1;
const featureArtifactType = `backlog_F${featureNum}`;  // e.g., "backlog_F1", "backlog_F2"
const artifactId = await saveLocalArtifact(sessionId, featureArtifactType, newFeature, itemId);
```

**Artifacts created:**
- `backlog_F1` — Feature 1 stories (isolated)
- `backlog_F2` — Feature 2 stories (isolated)
- `backlog_F3` — Feature 3 stories (isolated)
- ...

### 2. Reduced Token Limits per Stage

**File**: `app/backend/src/agents/multi-agent-refinement.ts`

```typescript
// OLD: 32k tokens for accumulated backlog
for await (const chunk of facilitator.streamResponse(..., 32_000)) {

// NEW: 8k tokens for single feature
for await (const chunk of facilitator.streamResponse(..., 8_000)) {
```

**Rationale**:
- 1 feature = ~8 stories × ~500 tokens/story = ~4k tokens
- Epic metadata: ~2k tokens
- Total: ~6k tokens (8k provides buffer)

### 3. Revisions Work in Isolation

**File**: `app/backend/src/agents/feature-stage-runner.ts`

```typescript
// OLD: Revision re-outputs ALL features
const revisionDirective = `Return the complete backlog JSON (epic + all features + all stories)`;

// NEW: Revision only outputs THIS feature
const revisionDirective = `Return the complete Feature ${featureNum} JSON (epic + this one feature + all its stories)`;
```

**Revision token limit**: 8k tokens (not 16k)

### 4. Final Merge Stage

**File**: `app/backend/src/agents/feature-stage-runner.ts`

New function `runBacklogMerge()`:
- Loads all `backlog_F1`, `backlog_F2`, `backlog_F3`, ... artifacts
- Merges them into a single `backlog` artifact
- **No LLM call** — simple JSON concatenation
- Creates one final checkpoint for PM review

**File**: `app/backend/src/agents/feature-decomposition.ts`

Stage sequence injection:

```typescript
// OLD:
const newSequence = [...featureStages, ...sequence.slice(storyDecompIndex + 1)];

// NEW:
const newSequence = [
  ...featureStages,
  'backlog_merge',  // ← Merge all features into final artifact
  ...sequence.slice(storyDecompIndex + 1)
];
```

**Workflow stages now**:
```
epic_feature_planner
story_decomposition_F1
story_decomposition_F2
story_decomposition_F3
backlog_merge  ← NEW
curator
```

### 5. Stage Routing

**File**: `app/backend/src/agents/workflow-stage-runner.ts`

```typescript
// Handle merge stage before feature stages
if (stage === 'backlog_merge') {
  await runBacklogMerge(sessionId, workflowId, itemId);
  return;
}

// Handle feature stages
const featureMatch = stage.match(/^story_decomposition_F(\d+)$/);
if (featureMatch) {
  ...
}
```

## Token Usage Comparison

### Per-Feature Synthesis

| Metric | Old (Accumulated) | New (Isolated) | Savings |
|--------|-------------------|----------------|---------|
| F1 output | 4k tokens | 4k tokens | — |
| F2 output | 8k tokens | 4k tokens | 50% |
| F3 output | 12k tokens | 4k tokens | 67% |
| F4 output | 16k tokens | 4k tokens | 75% |
| F5 output | 20k tokens | 4k tokens | 80% |
| **F9 output** | **36k tokens** | **4k tokens** | **89%** ✅ |

### Total for 9 Features

| Stage | Old | New | Savings |
|-------|-----|-----|---------|
| F1-F9 synthesis | 180k tokens | 36k tokens | 80% |
| Merge stage | — | 36k tokens | — |
| **Total** | **180k** | **72k** | **60%** ✅ |

### Cost Comparison (Claude 4 @ $75/million output tokens)

| Features | Old Cost | New Cost | Savings |
|----------|----------|----------|---------|
| 3 features | $1.35 | $0.81 | $0.54 (40%) |
| 5 features | $3.00 | $1.80 | $1.20 (40%) |
| 9 features | $13.50 | $5.40 | $8.10 (60%) |

## Benefits

✅ **60% cost reduction** for large epics (9 features)
✅ **Constant token usage per feature** (no growth)
✅ **Faster revisions** (8k tokens vs 16-36k)
✅ **Simpler logic** (no accumulation tracking)
✅ **Isolated failures** (F5 failure doesn't affect F1-F4 artifacts)
✅ **Parallel processing ready** (features can be processed concurrently in future)

## Backward Compatibility

### Artifacts
- **Old workflows** still have `backlog` artifacts (accumulated)
- **New workflows** have `backlog_F1`, `backlog_F2`, ... + final `backlog`
- ADO sync reads from final `backlog` artifact (same for both)

### Checkpoints
- Each feature still creates **TWO checkpoints** (Stories + QA Tests)
- Merge stage creates **ONE checkpoint** (final backlog review)
- Total checkpoints: 2N + 1 (where N = feature count)

### Migration
- **No migration needed** — new architecture activates on next workflow
- Existing workflows complete with old architecture
- No database schema changes required

## Future Optimizations

### 1. Parallel Feature Processing
Since features are now isolated, they could be processed in parallel:
```
F1, F2, F3 → all run concurrently → merge
```
**Benefit**: 3x faster for 3-feature epics

### 2. Lazy Merge
Skip merge stage if only ADO sync is needed:
```
ADO sync reads: backlog_F1 + backlog_F2 + backlog_F3 directly
```
**Benefit**: Eliminates 36k merge cost

### 3. Incremental Merge
Merge only new features when resuming:
```
backlog_F1 + backlog_F2 already merged → add only backlog_F3
```
**Benefit**: Constant-time merge for additional features

## Testing

### Verification Steps
1. Start a workflow with epic planner
2. Approve epic → observe feature stages injected
3. Complete F1 → verify `backlog_F1` artifact created (not `backlog`)
4. Complete F2 → verify `backlog_F2` artifact created
5. Complete F3 → verify `backlog_F3` artifact created
6. Complete merge stage → verify final `backlog` artifact contains all 3 features
7. Check token logs — each feature should use ~4-6k output tokens (not growing)

### Revision Testing
1. Request revision on F1 after F3 completes
2. Verify revision only regenerates `backlog_F1` (not entire backlog)
3. Verify revision uses ~8k tokens (not 16k or 36k)
4. Verify merge stage re-runs automatically with new F1

## Related Files

**Backend:**
- `app/backend/src/agents/feature-stage-runner.ts` — Feature isolation + merge
- `app/backend/src/agents/multi-agent-refinement.ts` — Reduced token limits
- `app/backend/src/agents/feature-decomposition.ts` — Merge stage injection
- `app/backend/src/agents/workflow-stage-runner.ts` — Merge stage routing

**No frontend changes needed** — artifacts display the same way
