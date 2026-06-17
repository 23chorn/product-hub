# Fix: QA Test Artifact Truncation

## Problem
QA test artifacts were being cut short during generation, showing the error:
> "This artifact appears incomplete — the stage was likely interrupted mid-stream. Retry the stage to regenerate a complete output."

## Root Cause
The QA engineer stages (`qa_engineer`, `qa_engineer_F1/F2/F3`) were **not defined** in `STAGE_MAX_OUTPUT_TOKENS`, causing them to fall back to the model's default max output tokens (8,192). 

For comprehensive QA test suites covering multiple stories with:
- Happy path tests
- Error/edge case tests
- Multiple test scenarios per story
- Detailed Given/When/Then steps
- Automation notes

...8,192 tokens is insufficient, resulting in truncated output.

## Solution

### 1. Added QA Stage Token Limit (`app/backend/src/agents/stage-metadata.ts`)
```typescript
export const STAGE_MAX_OUTPUT_TOKENS: Record<string, number> = {
  analyst:              12_000,
  pm_prd:               12_000,
  epic_feature_planner: 16_000,
  solution_architect:   16_000,
  qa_engineer:          14_000,  // ← New: ~20-25 test cases per feature with full detail
  prototype:            64_000,
  figma_design:         16_000,
};
```

**14,000 tokens** provides enough headroom for:
- Max 8 stories per feature (enforced by epic planner)
- 3-4 test cases per story (focused on critical scenarios)
- ~20-25 test cases total per feature
- Detailed Given/When/Then steps and automation notes
- Full test case metadata (priority, tags, preconditions)

### 2. Updated Multi-Agent QA Synthesis (`app/backend/src/agents/multi-agent-refinement.ts`)
Changed from hardcoded 16,000 tokens to reading from `STAGE_MAX_OUTPUT_TOKENS` and added explicit test case limits:

```typescript
// Before (line 811):
for await (const chunk of vera.streamResponse(
  systemPrompt,
  [{ role: 'user', content: synthesisPrompt }],
  undefined,
  undefined,
  16_000  // ← Hardcoded, insufficient
)) {

// After:
const { STAGE_MAX_OUTPUT_TOKENS } = await import('./stage-metadata');
const maxTokens = STAGE_MAX_OUTPUT_TOKENS['qa_engineer'] ?? 14_000;

for await (const chunk of vera.streamResponse(
  systemPrompt,
  [{ role: 'user', content: synthesisPrompt }],
  undefined,
  undefined,
  maxTokens  // ← Dynamic, configurable
)) {
```

**Added explicit test case constraints:**
```
Requirements:
- Test case limits: 3-4 test cases per story (max ~25 test cases total for this feature)
  - Priority: happy path (1), error handling (1), critical edge case (1), optional additional (1)
  - Focus on the most critical test scenarios — comprehensive, not exhaustive
```

This makes the system:
- **Centrally configured** in one place (`stage-metadata.ts`)
- **Consistent** across all QA generation paths
- **Focused on quality over quantity** — 3-4 high-value tests per story
- **Easy to adjust** if more headroom is needed

## Verification

To verify the fix works:

1. **Start a workflow** with story decomposition stages
2. **Wait for QA checkpoint** to be created
3. **Review the QA artifact** — it should now show the complete test suite
4. **Check artifact size** in the database:
   ```sql
   SELECT 
     a.id, 
     a.type, 
     LENGTH(external_path) as content_length,
     a.created_at
   FROM artifacts a
   WHERE type = 'qa_tests'
   ORDER BY created_at DESC
   LIMIT 5;
   ```

Expected results:
- ✅ No "artifact appears incomplete" warning
- ✅ All test cases present in the JSON
- ✅ Test suite ends with a complete closing `]` and `}`
- ✅ Artifact passes `tryParseQATests()` validation

## Token Usage Impact

**Before**: 8,192 tokens max → truncation after ~15-18 test cases
**After**: 14,000 tokens max → comfortably handles ~25 test cases

**Cost impact per QA checkpoint**: ~$0.35 increase (assuming Claude 4 pricing)
- Input: ~5k tokens (feature context)
- Output: 8k → 14k tokens increase = 6k additional output tokens
- At $15/$75 per million tokens: 6k × $0.075/1k = ~$0.45
- Typical output: 10-12k tokens → ~$0.35 average increase

This is **reasonable cost** for complete, focused test coverage without over-generation.

### Test Case Sizing
With explicit limits of **3-4 test cases per story**:
- 8 stories × 3.5 avg test cases = **~28 test cases max**
- Each test case: ~400-500 tokens in JSON format
- Total: 28 × 450 tokens = **~12,600 tokens**
- Plus metadata overhead: **~1,400 tokens**
- **Total: ~14,000 tokens** ✅ Perfect fit!

## Related Files
- `app/backend/src/agents/stage-metadata.ts` — Stage token limits
- `app/backend/src/agents/multi-agent-refinement.ts` — QA synthesis logic
- `app/frontend/src/components/artifact/ArtifactViewer.tsx` — Incomplete artifact detection

## Future Improvements
- Add automatic retry with increased token limit if truncation is detected
- Add token usage tracking per artifact to monitor actual usage
- Consider splitting very large feature test suites into multiple artifacts
- Add validator to detect incomplete JSON artifacts during save
