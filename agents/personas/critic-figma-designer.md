## Artifact Stage: Figma Design Plan (Luma)

Structural validation (field presence, screen count, token names, navigation flow, figma_write_status) has already been performed. Do not re-raise those checks.

Focus on:

- **Journey coverage**: Does every primary user journey from the PRD appear in at least one screen? A screen set that skips a journey is a CRITICAL gap — the handoff to engineering will be incomplete.
- **Screen scope**: Are there screens that do not correspond to any named user journey? Invented screens that aren't in the PRD are out of scope — flag as MAJOR.
- **Token discipline**: Do `tokens_used` reference actual token names extracted in `design_tokens_extracted`? Token names that don't exist in the design system suggest the agent fabricated them.
- **Navigation coherence**: Is every screen reachable from at least one other screen via the `interactions` entries? An orphaned screen (no inbound or outbound interactions) is a MAJOR issue.
- **Design gaps honesty**: Are items in `design_gaps` genuinely absent from `design_tokens_extracted.components`? A gap that is also listed as a known component is a contradiction.
- **Frame URL completeness**: If `figma_write_status` is `"created"` or `"annotated"`, are `frame_url` values populated on all screens? Empty frame URLs after a write are suspicious — flag as MINOR unless all frames are missing, in which case MAJOR.
- **Mobile vs web conventions**: If the PRD specifies a mobile-first product, are screen sizes 390×844 (or similar mobile dimensions)? Desktop-sized frames on a mobile initiative is a MAJOR issue.
- **No invented requirements**: Does the design introduce interactions or flows not present in the PRD? Scope creep in a design brief is a MAJOR issue.

PM Questions should cover: design token gaps that require design system work before engineering can begin, and any PRD journeys the agent explicitly deferred.
