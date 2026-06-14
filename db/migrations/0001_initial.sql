-- ============================================================
-- Migration 0001 — Initial schema (complete current state)
-- All statements use IF NOT EXISTS so this is safe to run
-- against an existing database that was previously managed
-- by the inline try/catch migration blocks in database.ts.
-- ============================================================

-- ------------------------------------------------------------
-- items
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS items (
  id          TEXT    PRIMARY KEY,
  type        TEXT    NOT NULL CHECK(type IN ('initiative','feature','bug','spike')),
  title       TEXT    NOT NULL,
  description TEXT,
  status      TEXT    NOT NULL DEFAULT 'active'
              CHECK(status IN ('active','in_progress','shipped','archived')),
  source      TEXT    NOT NULL DEFAULT 'airtable'
              CHECK(source IN ('airtable','quick_add','local')),
  airtable_id TEXT,
  metadata    TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_items_source ON items(source);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
--> statement-breakpoint

-- ------------------------------------------------------------
-- sessions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id                TEXT    PRIMARY KEY,
  item_id           TEXT    NOT NULL REFERENCES items(id),
  agent_id          TEXT    NOT NULL,
  mode              TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'active'
                    CHECK(status IN ('active','completed','cancelled','archived')),
  parent_session_id TEXT    REFERENCES sessions(id),
  workflow_context  TEXT,
  intended_output   TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sessions_item   ON sessions(item_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sessions_agent  ON sessions(agent_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);
--> statement-breakpoint

-- ------------------------------------------------------------
-- messages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role       TEXT    NOT NULL CHECK(role IN ('user','assistant','system')),
  content    TEXT    NOT NULL,
  sequence   INTEGER NOT NULL,
  timestamp  INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_messages_session_seq ON messages(session_id, sequence);
--> statement-breakpoint

-- ------------------------------------------------------------
-- skill_versions (defined before artifacts for FK reference)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skill_versions (
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
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_skill_versions_name ON skill_versions(skill_name);
--> statement-breakpoint

-- ------------------------------------------------------------
-- artifacts
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artifacts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type             TEXT    NOT NULL,
  file_path        TEXT    NOT NULL DEFAULT '',
  external_system  TEXT,
  external_path    TEXT,
  external_url     TEXT,
  skill_version_id INTEGER REFERENCES skill_versions(id),
  status           TEXT    NOT NULL DEFAULT 'draft'
                   CHECK(status IN ('draft','approved','superseded')),
  created_at       INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_artifacts_type    ON artifacts(type);
--> statement-breakpoint

-- ------------------------------------------------------------
-- item_status_snapshots
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS item_status_snapshots (
  airtable_id  TEXT    PRIMARY KEY,
  title        TEXT    NOT NULL,
  status       TEXT    NOT NULL,
  last_checked INTEGER NOT NULL
);
--> statement-breakpoint

-- ------------------------------------------------------------
-- context_change_proposals (legacy — superseded by context_diffs)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS context_change_proposals (
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
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_proposals_status  ON context_change_proposals(status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_proposals_session ON context_change_proposals(session_id);
--> statement-breakpoint

-- ------------------------------------------------------------
-- workflows
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflows (
  id                     TEXT    PRIMARY KEY,
  item_id                TEXT    NOT NULL REFERENCES items(id),
  goal                   TEXT    NOT NULL,
  summary                TEXT,
  status                 TEXT    NOT NULL DEFAULT 'active'
                         CHECK(status IN ('active','paused_at_checkpoint','awaiting_user_input','complete')),
  current_stage          TEXT,
  stage_sequence         TEXT    NOT NULL DEFAULT '[]',
  policy_overrides       TEXT    NOT NULL DEFAULT '{}',
  decomposition_metadata TEXT,
  estimated_cost         REAL    NOT NULL DEFAULT 0,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_workflows_item   ON workflows(item_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
--> statement-breakpoint

-- ------------------------------------------------------------
-- users (defined before checkpoints for FK reference)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT    UNIQUE COLLATE NOCASE,
  name          TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  slack_user_id TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email    ON users(email COLLATE NOCASE);
--> statement-breakpoint
UPDATE users SET username = lower(substr(email, 1, instr(email, '@') - 1))
  WHERE username IS NULL AND email IS NOT NULL;
--> statement-breakpoint

-- ------------------------------------------------------------
-- checkpoints
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS checkpoints (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id          TEXT    NOT NULL REFERENCES workflows(id),
  stage                TEXT    NOT NULL,
  artifact_id          INTEGER REFERENCES artifacts(id),
  status               TEXT    NOT NULL DEFAULT 'pending'
                       CHECK(status IN ('pending','approved','rejected','revised')),
  human_feedback       TEXT,
  coordinator_action   TEXT,
  token_usage          TEXT,
  required_role        TEXT,
  resolved_by_user_id  INTEGER REFERENCES users(id),
  created_at           INTEGER NOT NULL,
  resolved_at          INTEGER
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_checkpoints_workflow ON checkpoints(workflow_id);
--> statement-breakpoint

-- ------------------------------------------------------------
-- checkpoint_audit
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS checkpoint_audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  checkpoint_id INTEGER NOT NULL REFERENCES checkpoints(id),
  user_id       INTEGER REFERENCES users(id),
  user_name     TEXT    NOT NULL,
  user_email    TEXT    NOT NULL,
  action        TEXT    NOT NULL CHECK(action IN ('approved','rejected','revised')),
  notes         TEXT,
  created_at    INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_checkpoint_audit_cp   ON checkpoint_audit(checkpoint_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_checkpoint_audit_user ON checkpoint_audit(user_id);
--> statement-breakpoint

-- ------------------------------------------------------------
-- roles
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  description TEXT
);
--> statement-breakpoint
INSERT OR IGNORE INTO roles (name, description) VALUES
  ('product',   'Product managers — approve research and PRD stages'),
  ('tech_lead', 'Tech leads — approve architecture, epic planning, and story decomposition'),
  ('design',    'Designers — approve prototype stages');
--> statement-breakpoint

-- ------------------------------------------------------------
-- user_roles
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_roles (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_name TEXT    NOT NULL,
  PRIMARY KEY (user_id, role_name)
);
--> statement-breakpoint

-- ------------------------------------------------------------
-- stage_roles
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stage_roles (
  stage     TEXT NOT NULL PRIMARY KEY,
  role_name TEXT NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO stage_roles (stage, role_name) VALUES
  ('analyst',                'product'),
  ('pm_prd',                 'product'),
  ('solution_architect',     'tech_lead'),
  ('epic_feature_planner',   'tech_lead'),
  ('story_decomposition_F1', 'tech_lead'),
  ('story_decomposition_F2', 'tech_lead'),
  ('story_decomposition_F3', 'tech_lead'),
  ('prototype',              'design');
--> statement-breakpoint

-- ------------------------------------------------------------
-- context_diffs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS context_diffs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT    REFERENCES workflows(id),
  file_name   TEXT    NOT NULL,
  diff_content TEXT   NOT NULL,
  rationale   TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'pending'
              CHECK(status IN ('pending','approved','rejected')),
  approved_by TEXT,
  created_at  INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_context_diffs_status   ON context_diffs(status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_context_diffs_workflow ON context_diffs(workflow_id);
--> statement-breakpoint

-- ------------------------------------------------------------
-- coordinator_sessions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coordinator_sessions (
  id          TEXT    PRIMARY KEY,
  workflow_id TEXT    REFERENCES workflows(id) ON DELETE CASCADE,
  type        TEXT    NOT NULL CHECK(type IN ('pre_workflow','stage_briefing')),
  next_stage  TEXT,
  messages    TEXT    NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_coordinator_sessions_workflow ON coordinator_sessions(workflow_id);
--> statement-breakpoint

-- ------------------------------------------------------------
-- workflow_events
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT    NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  event_type  TEXT    NOT NULL,
  stage       TEXT,
  summary     TEXT    NOT NULL,
  details     TEXT,
  created_at  INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_workflow_events_workflow ON workflow_events(workflow_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_workflow_events_type     ON workflow_events(event_type);
--> statement-breakpoint

-- ------------------------------------------------------------
-- policies
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS policies (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scope       TEXT    NOT NULL CHECK(scope IN ('global','workflow_type','agent')),
  scope_value TEXT,
  rule_key    TEXT    NOT NULL,
  rule_value  TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE(scope, scope_value, rule_key)
);
--> statement-breakpoint

-- ------------------------------------------------------------
-- change_requests
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS change_requests (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id       TEXT    NOT NULL REFERENCES workflows(id),
  type              TEXT    NOT NULL CHECK(type IN ('scope','direction','constraint','stakeholder','technical','correction')),
  description       TEXT    NOT NULL,
  impact_assessment TEXT,
  status            TEXT    NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','assessed','in_progress','complete','cancelled')),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_change_requests_workflow ON change_requests(workflow_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_change_requests_status   ON change_requests(status);
--> statement-breakpoint

-- ------------------------------------------------------------
-- cr_artifact_versions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cr_artifact_versions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  change_request_id  INTEGER NOT NULL REFERENCES change_requests(id),
  stage              TEXT    NOT NULL,
  artifact_id        INTEGER NOT NULL REFERENCES artifacts(id),
  parent_artifact_id INTEGER REFERENCES artifacts(id),
  version            INTEGER NOT NULL DEFAULT 1,
  created_at         INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_cr_artifact_versions_cr ON cr_artifact_versions(change_request_id);
--> statement-breakpoint

-- ------------------------------------------------------------
-- ado_work_item_map
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ado_work_item_map (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT    NOT NULL REFERENCES workflows(id),
  artifact_id INTEGER REFERENCES artifacts(id),
  ado_id      INTEGER NOT NULL,
  ado_type    TEXT    NOT NULL CHECK(ado_type IN ('epic','feature','story')),
  ado_url     TEXT,
  local_key   TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_ado_map_key ON ado_work_item_map(workflow_id, local_key);
--> statement-breakpoint

-- ------------------------------------------------------------
-- qa_test_plan_map
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qa_test_plan_map (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id     TEXT    NOT NULL REFERENCES workflows(id),
  artifact_id     INTEGER REFERENCES artifacts(id),
  plan_id         INTEGER NOT NULL,
  root_suite_id   INTEGER,
  plan_url        TEXT    NOT NULL,
  suite_ids       TEXT    NOT NULL DEFAULT '{}',
  test_case_ids   TEXT    NOT NULL DEFAULT '{}',
  test_case_count INTEGER,
  created_at      INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_plan_workflow ON qa_test_plan_map(workflow_id);
--> statement-breakpoint

-- ------------------------------------------------------------
-- workflow_skill_assignments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_skill_assignments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id   TEXT    NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  stage         TEXT    NOT NULL,
  skill_name    TEXT    NOT NULL,
  skill_version TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_skill_assignments_workflow ON workflow_skill_assignments(workflow_id);
--> statement-breakpoint

-- ------------------------------------------------------------
-- context_file_versions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS context_file_versions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name  TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_context_file_versions_file ON context_file_versions(file_name, created_at);
--> statement-breakpoint

-- ------------------------------------------------------------
-- pipeline_runs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT    NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  pr_url      TEXT,
  branch      TEXT,
  pipeline_id TEXT,
  stage       TEXT    NOT NULL DEFAULT 'triggered',
  status      TEXT    NOT NULL DEFAULT 'running',
  test_results TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_workflow ON pipeline_runs(workflow_id, created_at);
