# Database Architecture

Two storage systems work in tandem: **SQLite** handles all relational state (orchestration, sessions, users, workflows), and **MongoDB** stores large artifact content. SQLite is the source of truth; MongoDB is an overflow store for document blobs.

---

## SQLite — `db/product-ops.db`

**Driver**: `better-sqlite3` (synchronous Node.js bindings)  
**Location**: `db/product-ops.db` (gitignored)  
**Schema file**: `db/schema.sql`  
**Code entry point**: `app/backend/src/data/database.ts`

WAL mode is enabled (`journal_mode = WAL`) for non-blocking reads during writes. Foreign keys are enforced (`PRAGMA foreign_keys = ON`).

### Tables

| Table | Purpose |
|-------|---------|
| `items` | Work-item registry. Every session, workflow, and artifact hangs off an item. `source` distinguishes Airtable-originated items from locally created ones. |
| `sessions` | One row per agent per item per sitting. Links back to `items`; chains to a parent via `parent_session_id`. |
| `messages` | Full conversation history per session. `sequence` column provides stable ordering independent of clock drift. |
| `artifacts` | Metadata row per output file. Points to content via `file_path` (disk) or `external_system`/`external_path` (MongoDB or Azure Wiki). |
| `workflows` | Orchestration unit spanning multiple agent sessions. Tracks `current_stage`, `stage_sequence` (JSON array), `estimated_cost`, and `policy_overrides`. |
| `checkpoints` | Human review pause points within a workflow. Transitions: `pending → approved | rejected | revised`. |
| `workflow_events` | Event log consumed by the frontend's narration thread. Polled via SSE. |
| `coordinator_sessions` | Persists coordinator planning conversations across page reloads. |
| `context_diffs` | Unified-diff proposals for `context/*.md` files. Approved diffs are applied atomically; the in-memory context cache is then invalidated. |
| `policies` | Key-value governance rules injected into the Coordinator system prompt at runtime (no restart needed). |
| `change_requests` | Post-completion targeted change requests with impact assessments. |
| `cr_artifact_versions` | Links a CR to the new artifact version it produced and its parent. Provides artifact lineage. |
| `ado_work_item_map` | Maps local keys (`F1`, `F1.S1`) to ADO work item IDs. Prevents duplicate pushes on re-runs. |
| `qa_test_plan_map` | Maps workflows to ADO Test Plan IDs and test suite/test case ID lookups. |
| `skill_versions` | Immutable snapshots of agent personas and tool definitions, versioned. Active version = `deprecated_at IS NULL`. |
| `workflow_skill_assignments` | Audit trail of which skill version ran for each stage of each workflow. |
| `users` | Auth table: username, email, bcrypt password hash, `is_admin` flag. |
| `roles` | Named roles (`product`, `tech_lead`, `design`). Seeded at startup. |
| `user_roles` | Many-to-many join: which users hold which roles. |
| `stage_roles` | Maps pipeline stages to the role required to approve them. |
| `checkpoint_audit` | Immutable audit log of checkpoint approve/reject/revise actions with user attribution. |
| `context_file_versions` | Snapshot history of every `context/*.md` save. Enables review/restore of context edits. |
| `pipeline_runs` | CI/CD pipeline execution records. Enables the PipelineStatus UI to display real results. |
| `context_change_proposals` | (Legacy) AI-proposed context edits — superseded by `context_diffs`. |
| `item_status_snapshots` | Tracks last-known Airtable status per initiative for change detection. |

### Migration pattern

Schema evolution is currently handled inline in `database.ts` with try/catch `ALTER TABLE` calls:

```ts
try { db.exec('ALTER TABLE items ADD COLUMN metadata TEXT'); } catch { /* already exists */ }
```

This is pragmatic for a single-developer local tool but does not scale well — see the analysis section below.

---

## MongoDB — `product-agent` database

**Driver**: `mongodb` (official Node.js driver)  
**Default URI**: `mongodb://localhost:27017`  
**Default DB**: `product-agent`  
**Code entry point**: `app/backend/src/data/mongo-client.ts`  
**Local setup**: `docker compose up -d`

### Why MongoDB alongside SQLite?

Specialist agent outputs (PRD JSON, architecture JSON, backlog) can be large structured documents. Storing them as raw `TEXT` blobs in SQLite works but forfeits native document querying and makes the db file grow unboundedly. MongoDB stores these as real BSON, preserving type fidelity and enabling field-level queries if needed later.

### Collection: `artifacts`

One document per specialist stage output.

```ts
interface ArtifactDocument {
  _id:           ObjectId;
  artifact_id:   number;        // back-reference to SQLite artifacts.id
  item_id:       string;
  session_id:    string;
  stage:         string;        // 'analyst' | 'pm_prd' | 'solution_architect' | ...
  artifact_type: string;        // 'research' | 'prd' | 'architecture' | ...
  content:       object | string;  // parsed BSON object or raw string
  created_at:    Date;
  updated_at:    Date;
}
```

Indexes: `artifact_id` (unique), `item_id`, `artifact_type`, `session_id`.

### How SQLite and MongoDB link

The `artifacts` SQLite row is the source of truth for metadata. When content lives in MongoDB:

- `artifacts.external_system = 'mongodb'`
- `artifacts.external_path = <ObjectId string>`
- `artifacts.file_path = ''` (empty)

The read path in `artifact-helpers.ts` checks `external_system` first, falls back to `file_path` on disk.

### Fallback behaviour

MongoDB connection uses a 3-second `serverSelectionTimeoutMS`. If unreachable at startup, `_available` is set to `false` and all subsequent calls return `null` without retrying — the caller falls back to writing content as a JSON file on disk instead.

---

## Storage dispatch flow

```
Agent produces output
        │
        ▼
saveLocalArtifact()
        │
        ├─► MongoDB available?
        │       ├─ YES → insertArtifactDoc() → SQLite row with external_system='mongodb'
        │       └─ NO  → write JSON to disk  → SQLite row with file_path=<path>
        │
Read path (readArtifactContent / loadArtifactContent):
        │
        ├─► external_system === 'mongodb' → readArtifactDoc(external_path)
        │       └─ miss → no disk fallback (log warning)
        └─► file_path set → fs.readFileSync(file_path)
```

---

## Analysis: should SQLite be replaced?

### What SQLite does well here

- **Zero ops**: single file, no daemon, trivial to back up (`cp product-ops.db backup.db`).
- **Synchronous API**: `better-sqlite3` is blocking — no `await` boilerplate throughout the codebase. For a single-process Express backend this is a significant ergonomic win.
- **ACID with WAL**: concurrent reads don't block writes. Writes serialize (one writer at a time), which is fine at this scale.
- **Schema is well-normalized**: the relational model fits the data perfectly. Workflows → stages → sessions → artifacts is a clear hierarchy.

### Current pain points

| Pain point | Severity |
|-----------|----------|
| Manual `ALTER TABLE` migrations in `database.ts` | Medium — works but fragments schema truth across two files and has no rollback |
| No migration versioning | Medium — can't tell what schema version a db is at |
| JSON blobs for `stage_sequence`, `policy_overrides`, `metadata`, `suite_ids` etc. | Low now — if these fields need filtering/querying, SQLite's JSON1 extension helps but it's verbose |
| Single-writer limit | Low now — will bite if the app moves to multi-process or serverless |
| No built-in replication/HA | Low now — local-only deployment |

### Should you switch?

**Short answer: no, not yet — but fix migrations.**

SQLite is the right choice for the current deployment model: single-tenant, single-process, developer-run. Switching to PostgreSQL or another server-based DB would add operational overhead (running a server, connection pooling, credentials) without meaningful benefit at this scale.

The real risk is the migration pattern, not the database engine. The try/catch `ALTER TABLE` approach will eventually cause silent failures on a column that already exists under a different type, or a migration that should have run but didn't.

### Recommended improvement: adopt a migration tool

Add [**Drizzle ORM**](https://orm.drizzle.team/) with its SQLite adapter (`drizzle-orm/better-sqlite3`). Drizzle is schema-first, generates typed queries, and produces versioned SQL migration files — no runtime try/catch needed. It also targets PostgreSQL and Turso with the same schema definition, so the migration path is a configuration change rather than a rewrite.

```
db/
  schema.ts        ← Drizzle schema (replaces schema.sql as source of truth)
  migrations/
    0001_init.sql
    0002_add_metadata.sql
    ...
```

### When to consider switching away from SQLite

Switch to **PostgreSQL** (via [Neon](https://neon.tech) for serverless, or self-hosted) if any of these become true:

- The app moves to a cloud-hosted multi-tenant model (multiple orgs share one deployment).
- More than one backend process needs to write concurrently.
- The JSON blob fields (`metadata`, `stage_sequence`, `suite_ids`) need real querying — `jsonb` in Postgres is far more capable than SQLite's JSON1.
- You need row-level security, logical replication, or read replicas.

Turso (libSQL over SQLite with replication) is a middle path: SQLite-compatible API, edge replication, multi-tenant support — worth evaluating if you want to stay SQLite-flavored but need cloud scale.

### MongoDB: keep as-is

The SQLite + MongoDB split is justified. Large structured documents belong in a document store; orchestration metadata belongs in a relational store. The fallback-to-disk pattern makes local dev friction-free. The only improvement worth making is ensuring the fallback disk artifacts are also cleaned up when MongoDB becomes available again (currently they're orphaned on disk).
