-- view_only is a hard-deny marker role: no approvals/rejections, no Studio edits,
-- no Airtable sync, no new initiatives — regardless of any other role a user holds.
INSERT OR IGNORE INTO roles (name, description) VALUES
  ('view_only', 'View only — can browse everything, cannot approve, edit, or sync anything');
