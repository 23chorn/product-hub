# Design Philosophy

Shared principles for how this system is built. These are decisions, not suggestions — new code should follow them without deviation.

---

## Demo mode is fixture injection only

Demo mode and production mode run identical code paths. The **only** difference is how the LLM response is obtained:

```typescript
// The one and only fork between demo and real
if (autoApprove) {
  fullResponse = fixtureContent;    // demo: use hardcoded fixture
} else {
  fullResponse = await streamLLM(); // real: call LLM
}

// Everything below here is shared — never branch on demo mode here
await saveArtifact(...);
await pushToAdo(...);
insertEvent(...);
createCheckpoint(...);
```

Everything after that fork — artifact saves, ADO pushes, wiki writes, event emission, checkpoint creation — must be identical for both paths.

**Signals:**
- `autoApprove` (set by `demo_auto_approve` policy override on the workflow) is the per-workflow demo signal. This is the only flag permitted to gate the LLM/fixture fork.
- `isDemoMode()` is UI-only. It controls what buttons and sections are visible in the frontend. It must never appear in backend workflow logic.

**Why this matters:** If demo branches accumulate in post-processing code, the demo stops reflecting what production actually does. The demo becomes a lie. Bugs that only exist in production go undetected because the demo never exercises that path.

**When adding a new feature:**
1. Add it to the shared code path after the LLM/fixture fork.
2. If the feature needs to be exercised in demo mode, update the relevant fixture file — do not add a demo-only branch.
3. Never guard post-LLM logic with `isDemoMode()`, `autoApprove`, or any environment check.

---

## Two state layers: operational (local) and published (external)

The system is **not stateless**. It has two distinct state layers with different purposes:

### Operational state — local DB + disk (ephemeral working copy)

The SQLite database and `data/sessions/` artifact files are the workflow's working state. Every downstream stage read, change request, frontend view, and agent input goes through this layer. It is required for the workflow to function.

```
Agent produces output
        │
        ▼
saveLocalArtifact()   ← disk: canonical working copy, feeds all downstream reads
        │
        ├── pushBacklogToAdo()    ← ADO Boards (side-effect, write-only)
        ├── pushTestPlanToAdo()   ← ADO Test Plans (side-effect, write-only)
        └── syncArtifactToWiki()  ← Azure Wiki (side-effect, write-only)
```

All downstream reads (`loadArtifactContentById`, `loadLatestArtifactForStage`, frontend viewer, change requests) go to local disk. Never read back from ADO or the wiki to feed a downstream stage.

### Published state — ADO + Wiki (permanent stakeholder record)

Azure Boards, Azure Test Plans, and Azure Wiki are write-only publish destinations. They hold the human-facing, permanent record of outputs that survives even if the local DB/disk is wiped. They are not queried by the workflow.

**Why external systems are write-only:** ADO stores data in its own format — work items as parent/child hierarchies, test cases as XML step fields. Reconstructing the internal JSON from ADO would be lossy and fragile. The local artifact file is always the authoritative representation.

**Consequence for artifact save helpers:**
- `saveLocalArtifact` — disk only. Used for all specialist-stage outputs, including those that push to ADO (`pm_backlog`, `tech_refinement`, `qa_engineer`).
- `syncArtifactToWiki` — called separately (`tryWikiPush()` in `workflow-stage-runner.ts`) for stages that publish to the wiki (`analyst`, `pm_prd`, `solution_architect`, `prototype`). Sets `wiki_path`/`wiki_url` on the same artifact row without touching `file_path` — disk stays the primary source.
