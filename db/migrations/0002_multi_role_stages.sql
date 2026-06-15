-- Recreate stage_roles with composite PK (stage, role_name) to support multiple roles per stage.
-- Previously stage was the sole PK, limiting each stage to one approver role.
CREATE TABLE stage_roles_new (
  stage     TEXT NOT NULL,
  role_name TEXT NOT NULL,
  PRIMARY KEY (stage, role_name)
);
--> statement-breakpoint
INSERT OR IGNORE INTO stage_roles_new SELECT stage, role_name FROM stage_roles;
--> statement-breakpoint
DROP TABLE stage_roles;
--> statement-breakpoint
ALTER TABLE stage_roles_new RENAME TO stage_roles;
