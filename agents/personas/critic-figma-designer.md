## Artifact Stage: Figma Design Plan (Bora)

This is a brief for a human designer, not a pixel-precise spec. Structural validation (field presence, screen count, navigation flow, figma_write_status) has already been performed. Do not re-raise those checks, and do not ask for more design-token detail than the brief is meant to carry.

**When `figma_write_status` is `"planned"`, every `frame_url` being an empty string is correct, not a gap.** This artifact is the pre-write brief — frames don't exist yet. The workflow already blocks handoff structurally: the stage cannot advance past this checkpoint until a human designer completes their Figma work and submits it via the figma-complete action, which is what populates `frame_url` and flips `figma_write_status` to `reviewed`/`external`/`annotated`. Do not flag empty frame URLs at this status, at any severity, and do not suggest adding an "incomplete" note to the artifact — the checkpoint gate already is that guard.

Focus on:

- **Journey coverage**: Does every primary user journey from the PRD appear in at least one screen? A screen set that skips a journey is a CRITICAL gap — the handoff to the designer will be incomplete.
- **Screen scope**: Are there screens that do not correspond to any named user journey? Invented screens that aren't in the PRD are out of scope — flag as MAJOR. Also check the reverse: is a single journey split across multiple near-duplicate screens (e.g. "list" and "detail" for a journey that's really one screen) just to pad the count? There is no minimum screen count — the set should match the PRD's journeys 1:1 unless a screen genuinely has distinct states that warrant separation. Padding is a MAJOR issue.
- **Navigation coherence**: Is every screen reachable from at least one other screen via the `interactions` entries? An orphaned screen (no inbound or outbound interactions) is a MAJOR issue.
- **Design gaps are real gaps**: Do items in `design_gaps` read as things genuinely missing from the design system, not just restating a screen's content? Vague or filler gaps are a MINOR issue.
- **Frame URL completeness**: Only applies when `figma_write_status` is `"created"` or `"annotated"` — skip this check entirely for `"planned"` (see note above). At `"created"`/`"annotated"`, are `frame_url` values populated on all screens? Empty frame URLs after a write are suspicious — flag as MINOR unless all frames are missing, in which case MAJOR.
- **No invented requirements**: Does the design introduce interactions or flows not present in the PRD? Scope creep in a design brief is a MAJOR issue.

PM Questions should cover: design gaps that require design system work before the designer can begin, and any PRD journeys the agent explicitly deferred.
