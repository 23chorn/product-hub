-- figma_design was never seeded a default approver role even though it already goes
-- through the standard rolesJson(stage) lookup like every other regular specialist stage.
INSERT OR IGNORE INTO stage_roles (stage, role_name) VALUES
  ('figma_design', 'design');
