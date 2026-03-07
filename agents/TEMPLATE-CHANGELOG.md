# Template Changelog

Documents what was removed from default output templates, why, and what signal would justify adding it back.

## Guiding Principle

Every section in every template must answer: **would a downstream agent or developer be blocked from starting work if this section were missing?** If no, it is supplementary. Supplementary sections inflate input tokens on every coordinator request and slow the pipeline without improving outcomes. They belong in extended variants, not defaults.

---

## Research Brief — market-steps/step-06-research-completion.md

**Changed:** Epic 2, STORY-2.4

### Removed from default output

| Section | Previous role | Reason removed |
|---------|---------------|----------------|
| Executive Summary | Overview of findings | Redundant — covered by Problem Space |
| Table of Contents | Navigation | Not needed for a 3-section brief |
| Market Research Introduction and Methodology | Credibility | PM agent does not use this |
| Market Size and Growth Projections | Context | Not needed to write a PRD |
| Pricing and Business Model Analysis | Strategic context | Not needed for initial PRD |
| Customer Segmentation and Targeting | Personas | Covered by User Personas in PRD step |
| Market Entry and Growth Strategies | GTM | Out of scope for product planning |
| Risk Assessment and Mitigation (full framework) | Risk planning | Condensed to 2–3 bullets in Constraints section |
| Implementation Roadmap and Success Metrics | Planning | Out of scope for research |
| Future Market Outlook | Strategic vision | Not actionable for immediate PRD work |
| Source Documentation and Appendices | Provenance | LLM cannot reliably cite live sources |

### Default output now

Three sections, max 600 words total:
1. **Problem Space** (max 200 words)
2. **Constraints and Risks** (max 150 words)
3. **Market Patterns** (max 150 words)

### Reinstatement criteria for extended format

Add the 11-section comprehensive document back as an extended variant (e.g. `step-06-research-completion-extended.md`) when:
- A team consistently finds the 3-section brief insufficient for PM decision-making
- A stage-specific policy requires source citations (e.g. regulated industry compliance research)
- Research is being archived as a standalone document for human stakeholders (not piped to the PM agent)

---

## Story Template — solutioning/create-epics-and-stories/steps/step-03-create-stories.md

**Changed:** Epic 2, STORY-2.4

### Added (new mandatory field)

**`agentContext`** — implementation context for the developer agent executing the story. Required because developer agents without this field repeatedly make wrong assumptions about file locations, APIs, and patterns, causing rework. This field is the most cost-effective addition to a story — it is small but prevents large downstream errors.

### Unchanged mandatory fields

- Story title
- User story (As a/I want/So that)
- Acceptance criteria (Given/When/Then)

### Moved to optional

| Field | Previous status | Reason moved |
|-------|-----------------|--------------|
| Additional AC blocks beyond 3 | Encouraged | 1–3 blocks is sufficient for most stories; more adds noise |
| NFR notes per story | Common practice | NFRs apply at epic or system level; per-story NFRs are usually implementation detail |
| Related architecture links | Nice to have | Include only when the story changes an existing architectural boundary |

### Reinstatement criteria

Add fields back to mandatory when:
- Audit of completed sprints shows a specific missing field caused repeated rework across 3+ stories
- A workflow policy (via the policies table) explicitly requires the field for a workflow type

---

## PRD — planning/create-prd/steps-c/step-09-functional.md

**Changed:** Epic 2, STORY-2.4

### Sections marked as required for Backlog Agent handoff

| Section | Required for backlog handoff |
|---------|------------------------------|
| Problem Statement | Yes |
| User Personas | Yes |
| Key User Journeys | Yes |
| Success Metrics | Helpful but not blocking |
| Functional Requirements | Yes |
| Non-Functional Requirements (step 10) | No — supplementary |
| Domain Compliance (step 5) | No — supplementary |
| Innovation Analysis (step 6) | No — supplementary |
| Document Polish (step 11) | No — presentation only |

**Nothing was removed** from the interactive PRD workflow. The annotation is additive — it marks which sections the Backlog Agent actually reads when generating stories. Teams doing coordinator-pipeline runs can skip steps 5, 6, 10, and 11 without degrading backlog quality.

### Reinstatement criteria for mandatory NFR/compliance steps in the pipeline

Make NFRs mandatory in coordinator pipeline when:
- Stories repeatedly miss security or performance constraints in acceptance criteria
- A workflow type policy (`require_nfr_section=true`) is added to the policies table

---

## Domain Research / Technical Research Step Files

**Status: not changed in this iteration.**

The domain and technical research workflows (`workflow-domain-research.md`, `workflow-technical-research.md`) were audited. Their step files follow the same 6-step pattern as market research. Their completion steps (step-06) produce comprehensive documents.

**Recommendation for next iteration:** Apply the same 3-section brief cap to `domain-steps/step-06-research-synthesis.md` and `technical-steps/step-06-research-synthesis.md`. Signal to act on this: if coordinator pipeline runs with domain or technical research stages produce oversized dynamic prompts that cause context issues.

---

## Create Product Brief workflow

**Status: not changed in this iteration.**

The product brief workflow (`analysis/create-product-brief/`) was audited. Its output is primarily for human stakeholders and is not currently piped to any agent downstream. No changes made.
