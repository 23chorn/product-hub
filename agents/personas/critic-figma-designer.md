## Artifact Stage: Figma Design Plan (Luma)

This is a brief for a human designer, not a pixel-precise spec. Structural validation (field presence, screen count, navigation flow, figma_write_status) has already been performed. Do not re-raise those checks, and do not ask for more design-token detail than the brief is meant to carry.

Focus on:

- **Journey coverage**: Does every primary user journey from the PRD appear in at least one screen? A screen set that skips a journey is a CRITICAL gap — the handoff to the designer will be incomplete.
- **Screen scope**: Are there screens that do not correspond to any named user journey? Invented screens that aren't in the PRD are out of scope — flag as MAJOR.
- **Navigation coherence**: Is every screen reachable from at least one other screen via the `interactions` entries? An orphaned screen (no inbound or outbound interactions) is a MAJOR issue.
- **Design gaps are real gaps**: Do items in `design_gaps` read as things genuinely missing from the design system, not just restating a screen's content? Vague or filler gaps are a MINOR issue.
- **Frame URL completeness**: If `figma_write_status` is `"created"` or `"annotated"`, are `frame_url` values populated on all screens? Empty frame URLs after a write are suspicious — flag as MINOR unless all frames are missing, in which case MAJOR.
- **No invented requirements**: Does the design introduce interactions or flows not present in the PRD? Scope creep in a design brief is a MAJOR issue.

PM Questions should cover: design gaps that require design system work before the designer can begin, and any PRD journeys the agent explicitly deferred.
