CREATE TABLE IF NOT EXISTS quick_feature_pushes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT    NOT NULL,
  description      TEXT    NOT NULL DEFAULT '',
  result_json      TEXT    NOT NULL,
  ado_feature_id   INTEGER,
  ado_feature_url  TEXT,
  ado_stories_json TEXT,
  pushed_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
