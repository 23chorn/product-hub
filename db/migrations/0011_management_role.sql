-- management is a read-only marker role: grants access to the stats
-- dashboard without granting any approval/edit/sync permissions.
INSERT OR IGNORE INTO roles (name, description) VALUES
  ('management', 'Management — read-only access to the stats dashboard');
