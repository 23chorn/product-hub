-- Deployment tracking table: records each deployment with version info
CREATE TABLE IF NOT EXISTS deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,
  commit_hash TEXT,
  commit_short TEXT,
  branch TEXT,
  tag TEXT,
  is_dirty INTEGER DEFAULT 0,
  build_time TEXT,
  deployed_at INTEGER NOT NULL,
  deployed_by TEXT,
  node_version TEXT,
  environment TEXT DEFAULT 'production'
);

CREATE INDEX idx_deployments_deployed_at ON deployments(deployed_at DESC);
CREATE INDEX idx_deployments_version ON deployments(version);
