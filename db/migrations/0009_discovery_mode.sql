-- ============================================================
-- Migration 0009 — Discovery Mode
-- Source documents (manual upload now, API-fed later) and
-- AI-suggested opportunities reviewed by a PM before promotion
-- into the existing items/workflows pipeline.
-- ============================================================

-- ------------------------------------------------------------
-- discovery_sources
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discovery_sources (
  id           TEXT    PRIMARY KEY,
  source_type  TEXT    NOT NULL
               CHECK(source_type IN ('user_interview','app_store_review','play_store_review','competitor_note','other')),
  title        TEXT    NOT NULL,
  content      TEXT    NOT NULL,
  origin       TEXT    NOT NULL DEFAULT 'manual'
               CHECK(origin IN ('manual','api')),
  external_id  TEXT,
  external_url TEXT,
  fetched_at   INTEGER,
  metadata     TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_discovery_sources_type ON discovery_sources(source_type);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_sources_external
  ON discovery_sources(source_type, external_id) WHERE external_id IS NOT NULL;
--> statement-breakpoint

-- ------------------------------------------------------------
-- discovery_runs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discovery_runs (
  id                TEXT    PRIMARY KEY,
  status            TEXT    NOT NULL DEFAULT 'running'
                    CHECK(status IN ('running','complete','error')),
  source_ids        TEXT    NOT NULL DEFAULT '[]',
  opportunity_count INTEGER NOT NULL DEFAULT 0,
  error             TEXT,
  triggered_by      INTEGER REFERENCES users(id),
  created_at        INTEGER NOT NULL,
  completed_at      INTEGER
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_discovery_runs_status ON discovery_runs(status, created_at);
--> statement-breakpoint

-- ------------------------------------------------------------
-- discovery_opportunities
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discovery_opportunities (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id           TEXT    NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
  title            TEXT    NOT NULL,
  description      TEXT    NOT NULL,
  rationale        TEXT    NOT NULL,
  confidence       REAL,
  evidence         TEXT    NOT NULL DEFAULT '[]',
  status           TEXT    NOT NULL DEFAULT 'new'
                   CHECK(status IN ('new','reviewed','promoted','dismissed')),
  promoted_item_id TEXT    REFERENCES items(id) ON DELETE SET NULL,
  reviewed_by      INTEGER REFERENCES users(id),
  reviewed_at      INTEGER,
  created_at       INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_discovery_opps_run    ON discovery_opportunities(run_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_discovery_opps_status ON discovery_opportunities(status, created_at);
--> statement-breakpoint

-- ------------------------------------------------------------
-- discovery_opportunity_sources
-- Many-to-many evidence trail: which source documents informed
-- a given opportunity.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discovery_opportunity_sources (
  opportunity_id INTEGER NOT NULL REFERENCES discovery_opportunities(id) ON DELETE CASCADE,
  source_id      TEXT    NOT NULL REFERENCES discovery_sources(id) ON DELETE CASCADE,
  PRIMARY KEY (opportunity_id, source_id)
);
