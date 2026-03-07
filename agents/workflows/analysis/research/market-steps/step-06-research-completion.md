# Market Research Step 6: Research Brief Completion

## MANDATORY EXECUTION RULES (READ FIRST):

- 📖 Read the complete step file before taking any action
- 🎯 Output must be a concise research brief — NOT a comprehensive research report
- 📏 Total output must not exceed 600 words. This is a hard constraint.
- ✅ Three sections only: Problem Space, Constraints and Risks, Market Patterns
- 🚫 FORBIDDEN: source lists, methodology sections, implementation roadmaps, appendices
- ✅ YOU MUST ALWAYS SPEAK OUTPUT in your Agent communication style with the config `{communication_language}`

## MINIMUM VIABLE OUTPUT PRINCIPLE

The research brief produced here is handed to the Product Manager agent to inform PRD creation.
The PM needs three things: understanding of the problem space, awareness of key risks, and relevant market patterns.
The PM does NOT need: market size tables, source citations, implementation timelines, or strategic frameworks.

If you are producing for deep research archival (not the coordinator pipeline), use the extended format documented in the TEMPLATE-CHANGELOG.

## CONTEXT BOUNDARIES:

- Current document and frontmatter from previous steps are available
- Research topic = "{{research_topic}}"
- Research goals = "{{research_goals}}"
- All market research steps (customer behavior, pain points, decisions, competitive analysis) have been completed

## YOUR TASK:

Synthesize all research into a concise three-section brief. Be specific. Use concrete observations, not general statements.

## OUTPUT FORMAT:

When the user selects [C], produce ONLY the following structure (no introduction, no preamble):

```markdown
## Problem Space

[Concise description of the problem domain, who experiences it, and what opportunity exists.
Use observations from the research steps. Max 200 words. Be specific about user pain — avoid vague generalities.]

## Constraints and Risks

[The key constraints (technical, regulatory, resource, competitive) and top 2–3 risks.
For each risk: one sentence on the risk, one sentence on the mitigation or watch point. Max 150 words.]

## Market Patterns

[Relevant patterns from the competitive landscape or adjacent markets worth knowing about.
What are competitors doing? What is working or failing? What assumptions are safe to make? Max 150 words.]
```

Total: max 600 words. If you find yourself adding a fourth section, cut content from the three sections instead.

## COMPLETION SEQUENCE:

### 1. Draft Brief

Review the research content from previous steps. Synthesize it into the three sections above.
Before presenting, count your words. If over 600: cut, do not add a new section.

### 2. Present Brief and Completion Option

Show the drafted brief to the user, then display:

"**Research brief complete.** Total: ~[word count] words.

[C] Accept — save brief and complete research workflow
[Edit] I'll revise a specific section — tell me which one and what to change"

### 3. Handle Response

**If [C]:** Append the three-section brief to the research document. Update frontmatter `stepsCompleted: [1, 2, 3, 4, 5, 6]`. Research workflow complete.

**If [Edit]:** User specifies which section and what to change. Revise that section only. Re-present brief. Re-display options.

## SUCCESS METRICS:

✅ Brief covers all three sections
✅ Total output ≤ 600 words
✅ Concrete observations, not generic statements
✅ No source lists, appendices, or extra sections
✅ User selects [C] before document is saved

## FAILURE MODES:

❌ Producing more than three sections
❌ Exceeding 600 words
❌ Generic or vague content ("this market is growing rapidly")
❌ Including methodology, source lists, or implementation guidance
❌ Saving content before user selects [C]

## NOTE ON EXTENDED FORMAT:

The previous version of this step produced an 11-section comprehensive market research document.
That format has been moved to an extended variant available on request.
See agents/TEMPLATE-CHANGELOG.md for the reinstatement criteria.
