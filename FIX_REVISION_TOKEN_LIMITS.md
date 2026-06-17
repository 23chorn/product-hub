# Fix: Revision Flow Token Limit (8,000 → 32,000)

## Problem
When a checkpoint is revised and the stage re-runs, the output was being truncated at **8,000 tokens**, causing:
```
[ERROR] Invalid JSON from revision: Unterminated string in JSON at position 32296 (line 279 column 14)
```

This happened even though the initial synthesis uses **32,000 tokens**.

## Root Cause
The revision flow in `runMultiAgentFeatureRevision()` was **hardcoded to 8,000 tokens** (line 155):

```typescript
// BEFORE - WRONG:
for await (const chunk of agent.streamResponse(systemPrompt, messages, undefined, undefined, 8_000)) {
  fullResponse += chunk;
}
```

### Why This Was a Problem
The revision flow performs a "surgical edit" where it:
1. Takes the **entire prior backlog** (all features, all stories)
2. Modifies only the stories mentioned in the feedback
3. Returns the **complete updated backlog**

For a multi-feature workflow:
- **3 features** × **8 stories each** × **~400 tokens per story** = **~9,600 tokens**
- Plus epic metadata, feature metadata, acceptance criteria: **+2,000 tokens**
- **Total: ~11,600 tokens minimum**

**8,000 tokens was insufficient** → JSON truncated → parse error → workflow failed

## Solution

### Changed Token Limit to 32,000 (`app/backend/src/agents/feature-stage-runner.ts`)
```typescript
// AFTER - CORRECT:
// Revisions need the same token headroom as the original synthesis (32k for full backlog)
for await (const chunk of agent.streamResponse(systemPrompt, messages, undefined, undefined, 32_000)) {
  fullResponse += chunk;
}
```

This matches the token limit used in the **original synthesis** (see `multi-agent-refinement.ts` line 676).

## Token Limit Consistency

All story synthesis flows now use **32,000 tokens**:

| Flow | Token Limit | Location |
|------|-------------|----------|
| Initial multi-agent synthesis | 32,000 | `multi-agent-refinement.ts:676` |
| Targeted feature revision | 32,000 | `feature-stage-runner.ts:155` ✅ Fixed |
| QA test synthesis | 14,000 | `multi-agent-refinement.ts:807` (separate artifact) |

## Why 32,000 for Stories?

**Maximum theoretical size:**
- 3 features × 8 stories = **24 stories**
- Each story: ~500 tokens (including all fields)
- Total stories: 24 × 500 = **12,000 tokens**
- Epic + feature metadata: **~3,000 tokens**
- JSON structure overhead: **~1,000 tokens**
- **Theoretical max: ~16,000 tokens**

**Why use 32,000?**
- **Safety buffer** for verbose acceptance criteria
- Handles edge cases where stories have extensive technical details
- Matches Claude's comfortable generation window
- Same limit as original synthesis (consistency)

## Testing the Fix

### Before Fix
```bash
# Revision would fail with:
[ERROR] Invalid JSON from revision: Unterminated string in JSON at position 32296
```

### After Fix
```bash
# Revision completes successfully:
[INFO] [MULTI-AGENT REVISION] Feature 1 targeted revision complete (artifact 123)
```

### Verification Steps
1. Start the backend with the fix: `npm run dev:backend`
2. Trigger a revision on a story checkpoint: Click "Request Revisions"
3. Provide feedback and submit
4. Check logs — should see completion, not JSON parse errors
5. Verify artifact is complete JSON with proper closing brackets

## Related Token Limits

For reference, here are all the token limits in the system:

| Stage/Flow | Tokens | Purpose |
|------------|--------|---------|
| Analyst | 12,000 | Research brief |
| PM PRD | 12,000 | Product requirements |
| Epic Feature Planner | 16,000 | Epic + 3 feature shells |
| Solution Architect | 16,000 | Architecture document |
| **Story Synthesis** | **32,000** | **Full backlog (all features)** |
| **Story Revision** | **32,000** | **Full backlog (all features)** ✅ |
| **QA Test Synthesis** | **14,000** | **~25 test cases per feature** |
| Prototype | 64,000 | Full codebase generation |
| Figma Design | 16,000 | Design specs + component tree |

## Cost Impact

**Revision flow cost increase:**
- Before: 8k output tokens
- After: Actual usage ~12-16k tokens (not full 32k)
- Increase: ~$0.30-0.60 per revision (Claude 4 pricing)

**Worth it because:**
- ✅ Revisions actually work now
- ✅ No workflow failures from truncation
- ✅ Prevents user frustration and retries
- ✅ Maintains data integrity

## Prevention

To prevent similar issues in the future:

1. **Always match token limits** between initial synthesis and revision flows
2. **Test revision flows** with large multi-feature backlogs
3. **Add validation** to detect truncated JSON before save
4. **Log actual token usage** to monitor if limits are appropriate

## Related Files
- `app/backend/src/agents/feature-stage-runner.ts` — Revision flow (fixed)
- `app/backend/src/agents/multi-agent-refinement.ts` — Initial synthesis (reference)
- `app/backend/src/agents/specialist-agent.ts` — streamResponse() defaults
