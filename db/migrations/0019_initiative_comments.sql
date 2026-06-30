ALTER TABLE items ADD COLUMN is_paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN paused_at INTEGER;

CREATE TABLE IF NOT EXISTS initiative_comments (
  id          TEXT    PRIMARY KEY,
  item_id     TEXT    NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id     TEXT,
  author_name TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  type        TEXT    NOT NULL DEFAULT 'note'
              CHECK(type IN ('note', 'decision', 'pause', 'resume')),
  title       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_initiative_comments_item_id ON initiative_comments(item_id);
