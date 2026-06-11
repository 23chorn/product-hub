-- ============================================================
-- Product Ops Pipeline — Canonical Schema
-- Database: product-ops.db
-- ============================================================
-- A single SQLite database with logical isolation via agent_id.
-- One file to back up, open in a viewer, and manage in code.

-- ------------------------------------------------------------
-- items — Work Item Registry
-- Stable reference all sessions and artifacts link to.
-- item_id never changes. source distinguishes Airtable-originated
-- items from quick-add items created directly in chat.
-- ------------------------------------------------------------
CREATE TABLE items (
  id          TEXT    PRIMARY KEY,
  type        TEXT    NOT NULL CHECK(type IN ('initiative','feature','bug','spike')),
  title       TEXT    NOT NULL,
  description TEXT,
  status      TEXT    NOT NULL DEFAULT 'active'
              CHECK(status IN ('active','in_progress','shipped','archived')),
  source      TEXT    NOT NULL DEFAULT 'airtable'
              CHECK(source IN ('airtable','quick_add','local')),
  airtable_id TEXT,  -- null for quick_add/local items
  metadata    TEXT,  -- JSON blob for source-specific fields (e.g. Airtable priority, estimate)
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX idx_items_source ON items(source);
CREATE INDEX idx_items_status ON items(status);

-- ------------------------------------------------------------
-- sessions — Agent Conversation Sessions
-- One row per agent per work item per sitting.
-- Quick-add sessions use mode='backlog' and agent_id='pm-backlog'.
-- parent_session_id links sessions into a pipeline chain.
-- ------------------------------------------------------------
CREATE TABLE sessions (
  id               TEXT    PRIMARY KEY,
  item_id          TEXT    NOT NULL REFERENCES items(id),
  agent_id         TEXT    NOT NULL, -- 'pm-prd'|'pm-backlog'|'analyst'|...
  mode             TEXT    NOT NULL, -- 'prd'|'backlog'|'analyst'|...
  status           TEXT    NOT NULL DEFAULT 'active'
                   CHECK(status IN ('active','completed','cancelled','archived')),
  parent_session_id TEXT   REFERENCES sessions(id),
  workflow_context TEXT,             -- JSON blob for mid-workflow state
  intended_output  TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE INDEX idx_sessions_item   ON sessions(item_id);
CREATE INDEX idx_sessions_agent  ON sessions(agent_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_parent ON sessions(parent_session_id);

-- ------------------------------------------------------------
-- messages — Conversation History
-- Full message history per session. sequence provides explicit
-- ordering, more reliable than timestamp alone.
-- ------------------------------------------------------------
CREATE TABLE messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role       TEXT    NOT NULL CHECK(role IN ('user','assistant','system')),
  content    TEXT    NOT NULL,
  sequence   INTEGER NOT NULL,
  timestamp  INTEGER NOT NULL
);

CREATE INDEX idx_messages_session_seq ON messages(session_id, sequence);

-- ------------------------------------------------------------
-- artifacts — Session Outputs
-- Files produced by a session with lifecycle status.
-- type='backlog_item' covers quick-add outputs.
-- status tracks draft → approved → superseded.
-- ------------------------------------------------------------
CREATE TABLE artifacts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type             TEXT    NOT NULL, -- 'prd'|'backlog_item'|'rollout_plan'|...
  file_path        TEXT    NOT NULL DEFAULT '', -- empty for externally stored artifacts
  external_system  TEXT,            -- 'azure_wiki' | null
  external_path    TEXT,            -- wiki page path | null
  external_url     TEXT,            -- browser URL | null
  status           TEXT    NOT NULL DEFAULT 'draft'
                   CHECK(status IN ('draft','approved','superseded')),
  created_at       INTEGER NOT NULL
);

CREATE INDEX idx_artifacts_session ON artifacts(session_id);
CREATE INDEX idx_artifacts_type    ON artifacts(type);

-- ------------------------------------------------------------
-- staged_decisions — Decision Inbox
-- Agents write candidate decisions here freely.
-- Only the Decision Log Agent promotes entries to the permanent
-- monthly log.
-- ------------------------------------------------------------
CREATE TABLE staged_decisions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  agent_id        TEXT    NOT NULL,
  summary         TEXT    NOT NULL,
  rationale       TEXT,
  alternatives    TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','logged','dismissed')),
  decision_log_id TEXT,
  created_at      INTEGER NOT NULL
);

-- ------------------------------------------------------------
-- context_loads — Context Audit Trail (Phase 5+)
-- Records which files were loaded at which tier for each session.
-- Add usage once debugging context quality becomes a real need.
-- ------------------------------------------------------------
CREATE TABLE context_loads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tier       INTEGER NOT NULL CHECK(tier IN (1, 2, 3)),
  file_path  TEXT    NOT NULL,
  loaded_at  INTEGER NOT NULL
);

-- ------------------------------------------------------------
-- item_status_snapshots — Airtable Status Tracker
-- Stores the last-known Airtable status per initiative so the
-- Context Keeper can detect material status transitions by diff.
-- ------------------------------------------------------------
CREATE TABLE item_status_snapshots (
  airtable_id  TEXT    PRIMARY KEY,
  title        TEXT    NOT NULL,
  status       TEXT    NOT NULL,
  last_checked INTEGER NOT NULL
);

-- ------------------------------------------------------------
-- context_change_proposals — Context Update Proposals
-- AI-generated proposals to update context/*.md files.
-- Lifecycle: pending → confirmed (file written) | dismissed.
-- ------------------------------------------------------------
CREATE TABLE context_change_proposals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT    NOT NULL REFERENCES sessions(id),
  file_name     TEXT    NOT NULL,
  section_hint  TEXT,
  proposed_text TEXT    NOT NULL,
  rationale     TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','confirmed','dismissed')),
  created_at    INTEGER NOT NULL,
  reviewed_at   INTEGER
);

CREATE INDEX idx_proposals_status ON context_change_proposals(status);
CREATE INDEX idx_proposals_session ON context_change_proposals(session_id);

-- ------------------------------------------------------------
-- workflows — Goal-Oriented Orchestration Units
-- One workflow spans multiple agent sessions. The Coordinator
-- drives stage progression; checkpoints pause it for human review.
-- stage_sequence and policy_overrides are JSON-encoded TEXT.
-- ------------------------------------------------------------
CREATE TABLE workflows (
  id                      TEXT    PRIMARY KEY,
  item_id                 TEXT    NOT NULL REFERENCES items(id),
  goal                    TEXT    NOT NULL,
  summary                 TEXT,                             -- AI-generated brief name
  status                  TEXT    NOT NULL DEFAULT 'active'
                          CHECK(status IN ('active','paused_at_checkpoint','awaiting_user_input','complete')),
  current_stage           TEXT,
  stage_sequence          TEXT    NOT NULL DEFAULT '[]',   -- JSON array of stage names
  policy_overrides        TEXT    NOT NULL DEFAULT '{}',   -- JSON key-value overrides
  decomposition_metadata  TEXT,                             -- JSON metadata for feature-by-feature story decomposition
  estimated_cost          REAL    NOT NULL DEFAULT 0,      -- cumulative estimated USD cost
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL
);

CREATE INDEX idx_workflows_item   ON workflows(item_id);
CREATE INDEX idx_workflows_status ON workflows(status);

-- ------------------------------------------------------------
-- checkpoints — Human Review Pause Points
-- Created when a workflow reaches a stage requiring approval.
-- status transitions: pending → approved | rejected | revised
-- revised means feedback was given and the stage will rerun.
-- coordinator_action is a JSON blob of what the Coordinator decided.
-- ------------------------------------------------------------
CREATE TABLE checkpoints (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id        TEXT    NOT NULL REFERENCES workflows(id),
  stage              TEXT    NOT NULL,
  artifact_id        INTEGER REFERENCES artifacts(id),
  status             TEXT    NOT NULL DEFAULT 'pending'
                     CHECK(status IN ('pending','approved','rejected','revised')),
  human_feedback     TEXT,
  coordinator_action TEXT,   -- JSON blob
  token_usage        TEXT,   -- JSON: { specialist: TokenUsage, critic?: TokenUsage }
  created_at         INTEGER NOT NULL,
  resolved_at        INTEGER
);

CREATE INDEX idx_checkpoints_workflow ON checkpoints(workflow_id);

-- ------------------------------------------------------------
-- context_diffs — Context File Change Proposals
-- The Context Curator writes unified diffs here instead of
-- editing context/*.md directly. Approved diffs are applied
-- and the in-memory context cache is invalidated.
-- workflow_id is nullable (curator can run outside a workflow).
-- file_name stores the filename only (e.g. "company.md").
-- ------------------------------------------------------------
CREATE TABLE context_diffs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id  TEXT    REFERENCES workflows(id),
  file_name    TEXT    NOT NULL,
  diff_content TEXT    NOT NULL,
  rationale    TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'pending'
               CHECK(status IN ('pending','approved','rejected')),
  approved_by  TEXT,
  created_at   INTEGER NOT NULL
);

CREATE INDEX idx_context_diffs_status   ON context_diffs(status);
CREATE INDEX idx_context_diffs_workflow ON context_diffs(workflow_id);

-- ------------------------------------------------------------
-- coordinator_sessions — Coordinator Planning Conversations
-- Persists coordinator chat history so sessions survive page reloads.
-- workflow_id is null for pre-workflow planning (no workflow created yet).
-- type: 'pre_workflow' | 'stage_briefing'
-- messages: JSON array of {role:'user'|'assistant', content:string}
-- ------------------------------------------------------------
CREATE TABLE coordinator_sessions (
  id          TEXT    PRIMARY KEY,
  workflow_id TEXT    REFERENCES workflows(id) ON DELETE CASCADE,
  type        TEXT    NOT NULL CHECK(type IN ('pre_workflow','stage_briefing')),
  next_stage  TEXT,
  messages    TEXT    NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX idx_coordinator_sessions_workflow ON coordinator_sessions(workflow_id);

-- ------------------------------------------------------------
-- workflow_events — Workflow Event Log
-- Stores narration events for the CoS conversation UI.
-- Each event represents a milestone (stage start/complete, critic
-- verdict, revision, error, workflow complete). The frontend polls
-- for new events to build the narration thread.
-- ------------------------------------------------------------
CREATE TABLE workflow_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT    NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  event_type  TEXT    NOT NULL,  -- 'stage_started','stage_completed','critic_verdict','revision','error','workflow_complete'
  stage       TEXT,
  summary     TEXT    NOT NULL,
  details     TEXT,              -- JSON blob
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_workflow_events_workflow ON workflow_events(workflow_id);
CREATE INDEX idx_workflow_events_type     ON workflow_events(event_type);

-- ------------------------------------------------------------
-- policies — Governance Rules
-- Key-value rules injected into the Coordinator's system prompt.
-- scope: 'global' | 'workflow_type' | 'agent'
-- rule_value is always a JSON string (e.g. "true", "8", '"professional"').
-- UNIQUE(scope, scope_value, rule_key) enables upsert by natural key.
-- ------------------------------------------------------------
CREATE TABLE policies (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scope       TEXT    NOT NULL CHECK(scope IN ('global','workflow_type','agent')),
  scope_value TEXT,   -- null for global; workflow type name or agent id otherwise
  rule_key    TEXT    NOT NULL,
  rule_value  TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE(scope, scope_value, rule_key)
);

-- ------------------------------------------------------------
-- change_requests — Post-Completion Change Requests
-- One CR per post-completion targeted change. CRs allow
-- updating specific artifacts without full-stage reruns.
-- ------------------------------------------------------------
CREATE TABLE change_requests (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id      TEXT    NOT NULL REFERENCES workflows(id),
  type             TEXT    NOT NULL CHECK(type IN ('scope','direction','constraint','stakeholder','technical','correction')),
  description      TEXT    NOT NULL,
  impact_assessment TEXT,  -- JSON: { affected_stages, summary }
  status           TEXT    NOT NULL DEFAULT 'pending'
                   CHECK(status IN ('pending','assessed','in_progress','complete','cancelled')),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE INDEX idx_change_requests_workflow ON change_requests(workflow_id);
CREATE INDEX idx_change_requests_status   ON change_requests(status);

-- ------------------------------------------------------------
-- cr_artifact_versions — CR Artifact Lineage
-- Links a change request to the new artifact it produced and
-- its parent artifact for version tracking.
-- ------------------------------------------------------------
CREATE TABLE cr_artifact_versions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  change_request_id  INTEGER NOT NULL REFERENCES change_requests(id),
  stage              TEXT    NOT NULL,
  artifact_id        INTEGER NOT NULL REFERENCES artifacts(id),
  parent_artifact_id INTEGER REFERENCES artifacts(id),
  version            INTEGER NOT NULL DEFAULT 1,
  created_at         INTEGER NOT NULL
);

CREATE INDEX idx_cr_artifact_versions_cr ON cr_artifact_versions(change_request_id);

-- ------------------------------------------------------------
-- ado_work_item_map — ADO Work Item ID Persistence
-- Maps local backlog structure keys to ADO work item IDs so
-- push-to-board can update existing items instead of creating
-- duplicates.
-- ------------------------------------------------------------
CREATE TABLE ado_work_item_map (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT    NOT NULL REFERENCES workflows(id),
  artifact_id INTEGER REFERENCES artifacts(id),  -- nullable: epic/feature rows don't have specific artifacts
  ado_id      INTEGER NOT NULL,
  ado_type    TEXT    NOT NULL CHECK(ado_type IN ('epic','feature','story')),
  ado_url     TEXT,
  local_key   TEXT    NOT NULL,  -- "epic", "F1", "F1.S1", "F2.S3"
  title       TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_ado_map_key ON ado_work_item_map(workflow_id, local_key);

-- ------------------------------------------------------------
-- qa_test_plan_map — ADO Test Plans Persistence
-- One row per workflow. Tracks the ADO Test Plan ID, the IDs of
-- each test suite (keyed by test type), and a map of QA test
-- case IDs (TC-001 etc.) to ADO work item IDs for idempotent sync.
-- ------------------------------------------------------------
CREATE TABLE qa_test_plan_map (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id     TEXT    NOT NULL REFERENCES workflows(id),
  artifact_id     INTEGER REFERENCES artifacts(id),
  plan_id         INTEGER NOT NULL,
  root_suite_id   INTEGER,
  plan_url        TEXT    NOT NULL,
  suite_ids       TEXT    NOT NULL DEFAULT '{}',  -- JSON: { "happy_path": 1234, … }
  test_case_ids   TEXT    NOT NULL DEFAULT '{}',  -- JSON: { "TC-001": 5678, … }
  test_case_count INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_qa_plan_workflow ON qa_test_plan_map(workflow_id);

-- ------------------------------------------------------------
-- skill_versions — Versioned Skill Registry
-- Each row is an immutable snapshot of an agent skill at a
-- given version. Agents load from here first; disk files are
-- the fallback. Teams own skills by setting owner_team.
-- deprecated_at = null means the version is active.
-- UNIQUE(skill_name, version) prevents duplicate versions.
-- ------------------------------------------------------------
CREATE TABLE skill_versions (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_name             TEXT    NOT NULL,
  agent_type             TEXT    NOT NULL,
  version                TEXT    NOT NULL,
  owner_team             TEXT    NOT NULL DEFAULT 'core',
  discipline             TEXT    NOT NULL DEFAULT 'agent',
  persona_prompt         TEXT    NOT NULL DEFAULT '',
  output_format_template TEXT,
  stage_brief_label      TEXT,
  stage_brief_format     TEXT,
  development_context    TEXT,
  tool_definitions       TEXT,
  created_at             INTEGER NOT NULL,
  deprecated_at          INTEGER,
  UNIQUE(skill_name, version)
);

CREATE INDEX idx_skill_versions_name ON skill_versions(skill_name);

-- ------------------------------------------------------------
-- workflow_skill_assignments — Stage Skill Audit Trail
-- Records which skill version ran for each stage of each
-- workflow. Enables cost attribution and rollback analysis.
-- ------------------------------------------------------------
CREATE TABLE workflow_skill_assignments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id   TEXT    NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  stage         TEXT    NOT NULL,
  skill_name    TEXT    NOT NULL,
  skill_version TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_skill_assignments_workflow ON workflow_skill_assignments(workflow_id);

-- ------------------------------------------------------------
-- context_file_versions — Context File Edit History
-- Records a snapshot of every non-empty save to a context/*.md
-- file so edits can be reviewed or restored.
-- ------------------------------------------------------------
CREATE TABLE context_file_versions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name  TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_context_file_versions_file ON context_file_versions(file_name, created_at);

-- ------------------------------------------------------------
-- pipeline_runs — CI/CD Pipeline Execution Records
-- Stores results from real or demo pipeline runs triggered by
-- the ai-ready tag on ADO work items. Enables PipelineStatus-
-- Section to display real test results instead of mock timers.
-- ------------------------------------------------------------
CREATE TABLE pipeline_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id  TEXT    NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  pr_url       TEXT,
  branch       TEXT,
  pipeline_id  TEXT,
  stage        TEXT    NOT NULL DEFAULT 'triggered',
  status       TEXT    NOT NULL DEFAULT 'running',
  test_results TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX idx_pipeline_runs_workflow ON pipeline_runs(workflow_id, created_at);
