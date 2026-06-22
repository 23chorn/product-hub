---
stages: []
---
# Documentation Review Guidelines

These are the documentation committee's standing instructions to the AI doc reviewer
("Review with AI" in Knowledge Studio → Documentation Review). They're injected verbatim
into the reviewer's system prompt for every on-demand, single-file review — they are
**not** part of the staged product pipeline (hence `stages: []` above), so they don't show
up in any specialist agent's context.

Edit this file directly (copy it to `doc-review-guidelines.md` to activate it — see
`context/README.md` for the `*.md` vs `*.example.md` convention) to steer what the
reviewer looks for. A few examples of the kind of guidance that belongs here:

## Required sections

Every README should have: a one-line purpose statement, a "Getting started" or "Setup"
section, and an owning team. Flag any file missing these as a `major` suggestion.

## Staleness signals

Flag references to deprecated tools, retired services, or version numbers that look more
than a year old. Flag "TODO" / "TBD" / "coming soon" language that reads like it was never
followed up on.

## Tone and audience

Assume the reader is an engineer joining the owning team for the first time — flag jargon
or internal acronyms used without expansion on first use.

## Out of scope for the AI reviewer

Don't flag pure formatting/style nits (heading levels, line length) unless they actually
hurt readability — leave those for human reviewers to triage as `minor`.
