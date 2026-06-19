# How to Use xCube Behavior Documentation

This guide explains how these behavior documents should be integrated into the product workflow.

## Integration Points

### 1. PRD Phase (`pm_prd` stage)

**When:** During PRD creation for new features

**How to use:**
- Search for related existing features to understand current patterns
- Reference business rules and validation logic
- Ensure new features align with existing user flows
- Identify technical constraints from current implementation

**Example queries:**
```
"How does the current trade flow handle order validation?"
→ Check: xcube-docs_tradeflow.md, xcube-docs_ordervalidationrules.md

"What's the existing onboarding flow structure?"
→ Check: xcube-docs_onboarding.md

"How are deposits currently processed?"
→ Check: xcube-docs_deposit.md, xcube-docs_bank-transfer.md
```

### 2. Story Decomposition Phase (`story_decomposition` stage)

**When:** Breaking down features into implementable user stories

**How to use:**
- Understand existing screen flows to write consistent acceptance criteria
- Reference technical implementation patterns
- Identify reusable components and patterns
- Ensure stories don't conflict with existing business rules

**Example queries:**
```
"What screens are involved in the futures trading flow?"
→ Check: xcube-docs_future-tradelogic.md, xcube-docs_cd-futures.md

"What are the current market depth display rules?"
→ Check: xcube-docs_marketdepth.md

"How is portfolio data currently structured?"
→ Check: xcube-docs_portfolio.md
```

### 3. Technical Refinement Phase

**When:** Refining stories with technical details (Finn/Shard/Vera/Remi)

**How to use:**
- Understand current architecture to identify integration points
- Reference existing validation rules to avoid duplication
- Identify potential impacts on existing flows
- Check technical dependencies

**Example queries:**
```
"What's the current tech stack and architecture?"
→ Check: xcube-docs_architecture---tech-overview.md

"What validation rules exist for order placement?"
→ Check: xcube-docs_ordervalidationrules.md

"How do futures differ from stocks in the current implementation?"
→ Check: xcube-docs_tradeflow.md, xcube-docs_cd-futures.md, xcube-docs_cd-stocks-etf.md
```

## Loading Documents into Agent Context

### Option 1: Manual Reference
When creating a PRD or story for a specific feature area, manually read the relevant document(s) first:

```typescript
// In coordinator-agent.ts or specialist-agent.ts
const relevantDocs = await loadBehaviourDocs(['tradeflow', 'ordervalidationrules']);
// Include in system prompt
```

### Option 2: Semantic Search (Future Enhancement)
Implement semantic search over all behaviour docs to automatically surface relevant context:

```typescript
const relevantContext = await semanticSearch(userGoal, behaviourDocs);
// Inject top 3-5 most relevant sections into agent prompt
```

### Option 3: Agent Question-Answer
Allow agents to query behaviour docs during their workflow:

```typescript
// Agent can call: queryBehaviourDoc(feature, question)
// Returns: relevant section from that feature's documentation
```

## Document Structure Reference

Each document typically contains:

### Standard Sections
1. **Version Info** - Created by, version, last update
2. **Business Rules** - Numbered rules (e.g., T-01, T-02)
3. **Screen Flows** - Step-by-step navigation paths
4. **Calculations** - Formulas and computation logic
5. **Validation Rules** - Input validation and constraints
6. **Technical Details** - API calls, data structures, integration points

### Navigation Pattern
```
Feature Overview → User Actions → Screen Transitions → Calculations → Validation → Technical Implementation
```

## Keeping Documents Fresh

### When to Update
- After major feature releases
- When business rules change
- After architectural changes
- Quarterly reviews

### Update Process
```bash
# Fetch latest from Azure Wiki
npx tsx scripts/fetch-wiki-docs.ts

# Check git diff to see what changed
git diff context/behaviour/

# Commit if changes are significant
git add context/behaviour/
git commit -m "docs: sync behaviour docs from Azure Wiki"
```

## Best Practices

### ✅ DO
- Reference these docs at the START of PRD/story phases
- Use tree-map.json to understand the full feature landscape
- Cross-reference multiple docs for complex features (e.g., trading spans multiple docs)
- Note gaps or conflicts in existing documentation
- Update these docs after implementing changes

### ❌ DON'T
- Blindly copy existing patterns without understanding context
- Assume docs are complete or perfect (they may have gaps)
- Skip reading docs because "I know the feature"
- Create duplicate validation rules (check existing first)
- Let docs drift from implementation (keep them in sync)

## Example Workflow

### Scenario: Creating a PRD for "Stop-Loss Orders"

1. **Search related docs:**
   ```
   grep -i "stop\|order type\|limit\|market" context/behaviour/*.md
   → Finds: tradeflow.md, ordervalidationrules.md, cd-futures.md
   ```

2. **Read relevant sections:**
   - Current order types (Limit, Market)
   - Existing validation rules
   - Order entry screen flows
   - Technical implementation patterns

3. **Identify gaps:**
   - Stop-loss not currently supported
   - Need new order type
   - May need new validation rules
   - Screen flow needs new trigger type

4. **Write PRD with context:**
   - Reference existing order types
   - Extend validation rule numbering (T-10, T-11...)
   - Follow existing screen flow patterns
   - Note integration points with existing flows

5. **Flag in PRD:**
   ```markdown
   ## Current State (from xCube Docs)
   - Current order types: Limit, Market (see xcube-docs_tradeflow.md)
   - Validation rules: T-01 through T-09
   
   ## Proposed Changes
   - Add Stop-Loss order type
   - New validation rules: T-10, T-11
   - Extend order entry screen flow
   ```

## Questions?

If you encounter issues or have suggestions for improving this documentation system:
- Check the README.md in this folder
- Review the fetch-wiki-docs.ts script
- Refer to the workflow implementation in app/backend/src/agents/
