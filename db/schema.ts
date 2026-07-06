import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

// ── Core work items ───────────────────────────────────────────────────────────

export const items = sqliteTable('items', {
  id:          text('id').primaryKey(),
  type:        text('type', { enum: ['initiative', 'feature', 'bug', 'spike'] }).notNull(),
  title:       text('title').notNull(),
  description: text('description'),
  status:      text('status', { enum: ['active', 'in_progress', 'shipped', 'archived'] }).notNull().default('active'),
  source:      text('source', { enum: ['airtable', 'quick_add', 'local'] }).notNull().default('airtable'),
  airtable_id: text('airtable_id'),
  metadata:    text('metadata'),           // JSON blob
  shipped_at:  integer('shipped_at'),      // set when Airtable Status is detected as 'Shipped'
  seq_num:     integer('seq_num'),         // human-facing display number, assigned once at insert time — see nextItemSeqNum() in item-metadata.ts
  created_at:  integer('created_at').notNull(),
  updated_at:  integer('updated_at').notNull(),
}, (t) => [
  index('idx_items_source').on(t.source),
  index('idx_items_status').on(t.status),
  uniqueIndex('idx_items_seq_num').on(t.seq_num),
]);

export const sessions = sqliteTable('sessions', {
  id:                text('id').primaryKey(),
  item_id:           text('item_id').notNull().references(() => items.id),
  agent_id:          text('agent_id').notNull(),
  mode:              text('mode').notNull(),
  status:            text('status', { enum: ['active', 'completed', 'cancelled', 'archived'] }).notNull().default('active'),
  parent_session_id: text('parent_session_id').references((): any => sessions.id),
  workflow_context:  text('workflow_context'),   // JSON blob
  intended_output:   text('intended_output'),
  created_at:        integer('created_at').notNull(),
  updated_at:        integer('updated_at').notNull(),
}, (t) => [
  index('idx_sessions_item').on(t.item_id),
  index('idx_sessions_agent').on(t.agent_id),
  index('idx_sessions_status').on(t.status),
  index('idx_sessions_parent').on(t.parent_session_id),
]);

export const messages = sqliteTable('messages', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  session_id: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  role:       text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content:    text('content').notNull(),
  sequence:   integer('sequence').notNull(),
  timestamp:  integer('timestamp').notNull(),
}, (t) => [
  index('idx_messages_session_seq').on(t.session_id, t.sequence),
]);

// ── Artifacts ─────────────────────────────────────────────────────────────────
// Content always lives on disk under data/sessions/... — this table is just a
// pointer to that file, plus an optional external_url (e.g. the ADO work item
// this artifact was pushed to) and an optional wiki mirror (one-way, never the
// primary content source) so reads stay disk -> wiki(last resort).

export const artifacts = sqliteTable('artifacts', {
  id:               integer('id').primaryKey({ autoIncrement: true }),
  session_id:       text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  type:             text('type').notNull(),
  file_path:        text('file_path').notNull().default(''),
  external_url:     text('external_url'),
  wiki_path:        text('wiki_path'),
  wiki_url:         text('wiki_url'),
  status:           text('status', { enum: ['draft', 'approved', 'superseded'] }).notNull().default('draft'),
  created_at:       integer('created_at').notNull(),
}, (t) => [
  index('idx_artifacts_session').on(t.session_id),
  index('idx_artifacts_type').on(t.type),
]);

// ── Auth & roles ──────────────────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id:            integer('id').primaryKey({ autoIncrement: true }),
  username:      text('username').notNull().unique(),
  email:         text('email').unique(),
  name:          text('name').notNull(),
  password_hash: text('password_hash').notNull(),
  is_admin:      integer('is_admin').notNull().default(0),
  slack_user_id: text('slack_user_id'),
  created_at:    integer('created_at').notNull(),
  updated_at:    integer('updated_at').notNull(),
}, (t) => [
  uniqueIndex('idx_users_username').on(t.username),
  uniqueIndex('idx_users_email').on(t.email),
]);

export const roles = sqliteTable('roles', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  name:        text('name').notNull().unique(),
  description: text('description'),
});

export const userRoles = sqliteTable('user_roles', {
  user_id:   integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role_name: text('role_name').notNull(),
}, (t) => [
  uniqueIndex('user_roles_pk').on(t.user_id, t.role_name),
]);

export const stageRoles = sqliteTable('stage_roles', {
  stage:     text('stage').notNull(),
  role_name: text('role_name').notNull(),
}, (t) => [
  primaryKey({ columns: [t.stage, t.role_name] }),
]);

// ── Workflows ─────────────────────────────────────────────────────────────────

export const workflows = sqliteTable('workflows', {
  id:                     text('id').primaryKey(),
  item_id:                text('item_id').notNull().references(() => items.id),
  goal:                   text('goal').notNull(),
  summary:                text('summary'),
  status:                 text('status', { enum: ['active', 'paused_at_checkpoint', 'awaiting_user_input', 'complete'] }).notNull().default('active'),
  current_stage:          text('current_stage'),
  stage_sequence:         text('stage_sequence').notNull().default('[]'),   // JSON array
  policy_overrides:       text('policy_overrides').notNull().default('{}'), // JSON object
  decomposition_metadata: text('decomposition_metadata'),                   // JSON blob
  estimated_cost:         real('estimated_cost').notNull().default(0),
  created_at:             integer('created_at').notNull(),
  updated_at:             integer('updated_at').notNull(),
}, (t) => [
  index('idx_workflows_item').on(t.item_id),
  index('idx_workflows_status').on(t.status),
]);

export const checkpoints = sqliteTable('checkpoints', {
  id:                  integer('id').primaryKey({ autoIncrement: true }),
  workflow_id:         text('workflow_id').notNull().references(() => workflows.id),
  stage:               text('stage').notNull(),
  artifact_id:         integer('artifact_id').references(() => artifacts.id),
  status:              text('status', { enum: ['pending', 'approved', 'rejected', 'revised'] }).notNull().default('pending'),
  human_feedback:      text('human_feedback'),
  coordinator_action:  text('coordinator_action'),   // JSON blob
  token_usage:         text('token_usage'),           // JSON blob
  required_role:       text('required_role'),
  resolved_by_user_id: integer('resolved_by_user_id').references(() => users.id),
  created_at:          integer('created_at').notNull(),
  resolved_at:         integer('resolved_at'),
}, (t) => [
  index('idx_checkpoints_workflow').on(t.workflow_id),
]);

// Deterministic cross-feature scope-overlap candidates surfaced at the backlog_merge
// stage — see detectBacklogOverlaps() in agents/backlog-overlap.ts. Human reviews each
// pair and marks it confirmed (real duplicate) or dismissed (false positive).
export const backlogOverlapFlags = sqliteTable('backlog_overlap_flags', {
  id:                  integer('id').primaryKey({ autoIncrement: true }),
  workflow_id:         text('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  item_id:             text('item_id').notNull().references(() => items.id),
  feature_key_a:       text('feature_key_a').notNull(),
  story_id_a:          text('story_id_a').notNull(),
  feature_key_b:       text('feature_key_b').notNull(),
  story_id_b:          text('story_id_b').notNull(),
  score:               real('score').notNull(),
  matched_terms:       text('matched_terms').notNull().default('[]'),   // JSON string[]
  status:              text('status', { enum: ['pending', 'confirmed', 'dismissed'] }).notNull().default('pending'),
  resolved_by_user_id: integer('resolved_by_user_id').references(() => users.id),
  resolved_at:         integer('resolved_at'),
  notes:               text('notes'),
  created_at:          integer('created_at').notNull(),
}, (t) => [
  index('idx_backlog_overlap_flags_workflow').on(t.workflow_id),
]);

export const checkpointAudit = sqliteTable('checkpoint_audit', {
  id:            integer('id').primaryKey({ autoIncrement: true }),
  checkpoint_id: integer('checkpoint_id').notNull().references(() => checkpoints.id),
  user_id:       integer('user_id').references(() => users.id),
  user_name:     text('user_name').notNull(),
  user_email:    text('user_email').notNull(),
  action:        text('action', { enum: ['approved', 'rejected', 'revised'] }).notNull(),
  notes:         text('notes'),
  created_at:    integer('created_at').notNull(),
}, (t) => [
  index('idx_checkpoint_audit_cp').on(t.checkpoint_id),
  index('idx_checkpoint_audit_user').on(t.user_id),
]);

export const workflowEvents = sqliteTable('workflow_events', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  workflow_id: text('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  event_type:  text('event_type').notNull(),
  stage:       text('stage'),
  summary:     text('summary').notNull(),
  details:     text('details'),   // JSON blob
  created_at:  integer('created_at').notNull(),
}, (t) => [
  index('idx_workflow_events_workflow').on(t.workflow_id),
  index('idx_workflow_events_type').on(t.event_type),
]);

export const coordinatorSessions = sqliteTable('coordinator_sessions', {
  id:          text('id').primaryKey(),
  workflow_id: text('workflow_id').references(() => workflows.id, { onDelete: 'cascade' }),
  type:        text('type', { enum: ['pre_workflow', 'stage_briefing'] }).notNull(),
  next_stage:  text('next_stage'),
  messages:    text('messages').notNull().default('[]'),   // JSON array
  created_at:  integer('created_at').notNull(),
  updated_at:  integer('updated_at').notNull(),
}, (t) => [
  index('idx_coordinator_sessions_workflow').on(t.workflow_id),
]);

export const policies = sqliteTable('policies', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  scope:       text('scope', { enum: ['global', 'workflow_type', 'agent'] }).notNull(),
  scope_value: text('scope_value'),
  rule_key:    text('rule_key').notNull(),
  rule_value:  text('rule_value').notNull(),
  created_at:  integer('created_at').notNull(),
}, (t) => [
  uniqueIndex('policies_scope_key_unique').on(t.scope, t.scope_value, t.rule_key),
]);

// ── Change requests ───────────────────────────────────────────────────────────

export const changeRequests = sqliteTable('change_requests', {
  id:                integer('id').primaryKey({ autoIncrement: true }),
  workflow_id:       text('workflow_id').notNull().references(() => workflows.id),
  type:              text('type', { enum: ['scope', 'direction', 'constraint', 'stakeholder', 'technical', 'correction'] }).notNull(),
  description:       text('description').notNull(),
  impact_assessment: text('impact_assessment'),   // JSON blob
  status:            text('status', { enum: ['pending', 'assessed', 'in_progress', 'complete', 'cancelled'] }).notNull().default('pending'),
  created_at:        integer('created_at').notNull(),
  updated_at:        integer('updated_at').notNull(),
}, (t) => [
  index('idx_change_requests_workflow').on(t.workflow_id),
  index('idx_change_requests_status').on(t.status),
]);

export const crArtifactVersions = sqliteTable('cr_artifact_versions', {
  id:                 integer('id').primaryKey({ autoIncrement: true }),
  change_request_id:  integer('change_request_id').notNull().references(() => changeRequests.id),
  stage:              text('stage').notNull(),
  artifact_id:        integer('artifact_id').notNull().references(() => artifacts.id),
  parent_artifact_id: integer('parent_artifact_id').references(() => artifacts.id),
  version:            integer('version').notNull().default(1),
  created_at:         integer('created_at').notNull(),
}, (t) => [
  index('idx_cr_artifact_versions_cr').on(t.change_request_id),
]);

// ── ADO / QA integration ──────────────────────────────────────────────────────

export const adoWorkItemMap = sqliteTable('ado_work_item_map', {
  id:              integer('id').primaryKey({ autoIncrement: true }),
  workflow_id:     text('workflow_id').notNull().references(() => workflows.id),
  artifact_id:     integer('artifact_id').references(() => artifacts.id),
  ado_id:          integer('ado_id').notNull(),
  ado_type:        text('ado_type', { enum: ['epic', 'feature', 'story'] }).notNull(),
  ado_url:         text('ado_url'),
  local_key:       text('local_key').notNull(),
  title:           text('title').notNull(),
  state:           text('state'),            // raw ADO System.State, null until first refresh
  state_synced_at: integer('state_synced_at'), // epoch ms of last successful refresh
  created_at:      integer('created_at').notNull(),
}, (t) => [
  uniqueIndex('idx_ado_map_key').on(t.workflow_id, t.local_key),
]);

export const qaTestPlanMap = sqliteTable('qa_test_plan_map', {
  id:              integer('id').primaryKey({ autoIncrement: true }),
  workflow_id:     text('workflow_id').notNull().references(() => workflows.id),
  artifact_id:     integer('artifact_id').references(() => artifacts.id),
  plan_id:         integer('plan_id').notNull(),
  root_suite_id:   integer('root_suite_id'),
  plan_url:        text('plan_url').notNull(),
  suite_ids:       text('suite_ids').notNull().default('{}'),       // JSON object
  test_case_ids:   text('test_case_ids').notNull().default('{}'),   // JSON object
  test_case_count: integer('test_case_count'),
  created_at:      integer('created_at').notNull(),
}, (t) => [
  uniqueIndex('idx_qa_plan_workflow').on(t.workflow_id),
]);

// ── Audit / history ───────────────────────────────────────────────────────────

export const contextFileVersions = sqliteTable('context_file_versions', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  file_name:  text('file_name').notNull(),
  content:    text('content').notNull(),
  created_at: integer('created_at').notNull(),
}, (t) => [
  index('idx_context_file_versions_file').on(t.file_name, t.created_at),
]);

export const contextDiffs = sqliteTable('context_diffs', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  workflow_id:  text('workflow_id').references(() => workflows.id),
  file_name:    text('file_name').notNull(),
  diff_content: text('diff_content').notNull(),
  rationale:    text('rationale').notNull(),
  status:       text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('pending'),
  approved_by:  text('approved_by'),
  created_at:   integer('created_at').notNull(),
}, (t) => [
  index('idx_context_diffs_status').on(t.status),
  index('idx_context_diffs_workflow').on(t.workflow_id),
]);

export const pipelineRuns = sqliteTable('pipeline_runs', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  workflow_id:  text('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  pr_url:       text('pr_url'),
  branch:       text('branch'),
  pipeline_id:  text('pipeline_id'),
  stage:        text('stage').notNull().default('triggered'),
  status:       text('status').notNull().default('running'),
  test_results: text('test_results'),   // JSON blob
  created_at:   integer('created_at').notNull(),
  updated_at:   integer('updated_at').notNull(),
}, (t) => [
  index('idx_pipeline_runs_workflow').on(t.workflow_id, t.created_at),
]);

// ── Legacy (kept for backward compat) ────────────────────────────────────────

export const contextChangeProposals = sqliteTable('context_change_proposals', {
  id:            integer('id').primaryKey({ autoIncrement: true }),
  session_id:    text('session_id').notNull().references(() => sessions.id),
  file_name:     text('file_name').notNull(),
  section_hint:  text('section_hint'),
  proposed_text: text('proposed_text').notNull(),
  rationale:     text('rationale').notNull(),
  status:        text('status', { enum: ['pending', 'confirmed', 'dismissed'] }).notNull().default('pending'),
  created_at:    integer('created_at').notNull(),
  reviewed_at:   integer('reviewed_at'),
}, (t) => [
  index('idx_proposals_status').on(t.status),
  index('idx_proposals_session').on(t.session_id),
]);

export const itemStatusSnapshots = sqliteTable('item_status_snapshots', {
  airtable_id:  text('airtable_id').primaryKey(),
  title:        text('title').notNull(),
  status:       text('status').notNull(),
  last_checked: integer('last_checked').notNull(),
});

// ── Knowledge Studio: cross-repo documentation review ────────────────────────

export const kbRepos = sqliteTable('kb_repos', {
  id:                integer('id').primaryKey({ autoIncrement: true }),
  label:             text('label').notNull(),
  repository:        text('repository').notNull(),
  branch:            text('branch'),
  project:           text('project'),   // ADO project the repo lives in; null = the globally configured AZURE_DEVOPS_PROJECT
  created_by_user_id: integer('created_by_user_id').references(() => users.id),
  last_synced_at:    integer('last_synced_at'),
  created_at:        integer('created_at').notNull(),
}, (t) => [
  uniqueIndex('idx_kb_repos_repository').on(t.repository),
]);

export const kbFiles = sqliteTable('kb_files', {
  id:                     integer('id').primaryKey({ autoIncrement: true }),
  repo_id:                integer('repo_id').notNull().references(() => kbRepos.id, { onDelete: 'cascade' }),
  path:                   text('path').notNull(),
  frontmatter_file_name:  text('frontmatter_file_name'),
  frontmatter_owner:      text('frontmatter_owner'),
  frontmatter_status:     text('frontmatter_status'),
  frontmatter_valid:      integer('frontmatter_valid').notNull().default(0),
  content:                text('content').notNull().default(''),
  commit_id:              text('commit_id'),
  last_synced_at:         integer('last_synced_at').notNull(),
  created_at:             integer('created_at').notNull(),
}, (t) => [
  uniqueIndex('idx_kb_files_repo_path').on(t.repo_id, t.path),
  index('idx_kb_files_owner').on(t.frontmatter_owner),
  index('idx_kb_files_status').on(t.frontmatter_status),
]);

export const kbComments = sqliteTable('kb_comments', {
  id:                  integer('id').primaryKey({ autoIncrement: true }),
  file_id:             integer('file_id').notNull().references(() => kbFiles.id, { onDelete: 'cascade' }),
  source:              text('source', { enum: ['user', 'agent'] }).notNull(),
  author_user_id:      integer('author_user_id').references(() => users.id),
  author_name:         text('author_name').notNull(),
  body:                text('body').notNull(),
  quote:               text('quote'),
  status:              text('status', { enum: ['open', 'resolved'] }).notNull().default('open'),
  created_at:          integer('created_at').notNull(),
  resolved_at:         integer('resolved_at'),
  resolved_by_user_id: integer('resolved_by_user_id').references(() => users.id),
}, (t) => [
  index('idx_kb_comments_file').on(t.file_id),
]);

// ── Admin: linked Swagger/OpenAPI docs (current API context for the architect stage) ──

export const swaggerApiDocs = sqliteTable('swagger_api_docs', {
  id:                 integer('id').primaryKey({ autoIncrement: true }),
  label:              text('label').notNull(),
  doc_url:            text('doc_url').notNull(),
  active:             integer('active').notNull().default(1),
  spec_title:         text('spec_title'),     // info.title from the fetched spec, if parsable JSON
  spec_version:       text('spec_version'),   // info.version from the fetched spec, if parsable JSON
  content:            text('content'),        // raw fetched spec body, cached from the last sync
  last_synced_at:     integer('last_synced_at'),
  last_sync_error:    text('last_sync_error'),
  created_by_user_id: integer('created_by_user_id').references(() => users.id),
  created_at:         integer('created_at').notNull(),
}, (t) => [
  uniqueIndex('idx_swagger_api_docs_url').on(t.doc_url),
]);

// ── Deployment tracking ───────────────────────────────────────────────────────

export const deployments = sqliteTable('deployments', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  version:      text('version').notNull(),
  commit_hash:  text('commit_hash'),
  commit_short: text('commit_short'),
  branch:       text('branch'),
  tag:          text('tag'),
  is_dirty:     integer('is_dirty').default(0),
  build_time:   text('build_time'),
  deployed_at:  integer('deployed_at').notNull(),
  deployed_by:  text('deployed_by'),
  node_version: text('node_version'),
  environment:  text('environment').default('production'),
}, (t) => [
  index('idx_deployments_deployed_at').on(t.deployed_at),
  index('idx_deployments_version').on(t.version),
]);
