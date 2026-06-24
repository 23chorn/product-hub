# CLAUDE.md

Guidance for any agent working in this repository. Read this before writing code.

For architecture, commands, and domain details see **[docs/CLAUDE.md](docs/CLAUDE.md)**.
This file is about *how* to write the code: the bar is **clean, simple, and shared**.

## Core principle: keep it clean and simple, share by default

When adding or changing code, treat duplication as a bug. Before writing a block,
check whether the logic already exists — if it does, call it; if it's about to exist
in two places, extract it to one. Simplicity and reuse beat cleverness and local
convenience every time.

### The rules

1. **Don't copy-paste logic.** Two near-identical blocks → one shared function whose
   differences are parameters (or a small config/spec object). If you find yourself
   editing "the same thing in the other place too", that's the signal to consolidate.

2. **Search before you write.** Grep for an existing helper, constant, or type before
   creating a new one. A second copy of a map, regex, or parse routine is almost never
   correct — the copies drift and one silently goes stale.

3. **One source of truth for shared data.** Lookup maps, stage metadata, platform
   regexes, field mappings, etc. live in exactly one place and are imported. Never
   inline a second copy "just for here".

4. **Prefer a config/spec object over branching twins.** When two flows are ~80% the
   same, write one driver function and pass a spec describing the differences, rather
   than two functions that must be kept in lockstep by hand.

5. **Static imports over dynamic `await import()`.** Only use `await import()` to break a
   genuine circular dependency, and leave a one-line comment saying so. Don't reach for
   it out of habit — a dynamic import of a plain constant is noise.

6. **Put new shared helpers where they can't cause cycles.** Small, widely-used utilities
   belong in a leaf module that depends on as little as possible (e.g. only the db), so
   any module can import them freely. See `app/backend/src/agents/item-metadata.ts`.

7. **Keep functions small and readable.** Match the surrounding code's style, naming, and
   comment density. A comment should explain *why*, not restate the code.

8. **Don't change behavior while refactoring.** Consolidation is for structure, not
   wording or logic. If a "duplicate" actually differs (e.g. terser event copy vs. a full
   document label), keep the difference — call it out, don't silently unify it.

### Canonical examples in this codebase

These are the shape every future change should follow:

- **Spec-driven twin collapse** — `runFeatureSurgicalRevision` + `SurgicalRevisionSpec`
  in `app/backend/src/agents/feature-stage-runner.ts`. One driver, two thin specs
  (`STORY_REVISION_SPEC`, `QA_REVISION_SPEC`).
- **Shared streaming helper** — `collectStreamWithHeartbeat` in
  `app/backend/src/agents/stage-metadata.ts`, reused by every single-stream LLM loop.
- **Leaf util module, one source of truth** — `readProductArea` / `coerceProductArea` /
  `readItemMetadata` in `app/backend/src/agents/item-metadata.ts`, imported by all five
  call sites that used to hand-roll the parse.
- **Single predicate for a repeated condition** — `isDemoWorkflow` in
  `app/backend/src/demo/demo-mode.ts`.
- **Module-level lookup maps instead of inline copies / if-else chains** —
  `STAGE_AIRTABLE_LINK_FIELD`, `STAGE_EVENT_LABEL` in
  `app/backend/src/agents/workflow-stage-runner.ts`; the `STAGE_*` maps in
  `stage-metadata.ts`.

## Before you finish

- `cd app/backend && npx tsc --noEmit` must pass (rebuild `app/shared` first if you
  touched its types — see docs/CLAUDE.md).
- `npm test` (from `app/backend/`) must pass.
- Re-read your diff: did you leave a dead import, a second copy of something, or a
  block that should have been a call to a shared helper? Fix it before handing off.
- **Don't start the dev server or drive a browser to verify UI/frontend changes.**
  The user tests those manually. Typecheck and existing tests are sufficient
  verification on your end — say so plainly instead of claiming visual confirmation.
