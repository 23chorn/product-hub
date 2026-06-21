-- ============================================================
-- Migration 0010 — items.shipped_at
-- Set when the Airtable status-change detector observes an
-- item's Status field flip to 'Shipped'. Marks the production
-- milestone for cycle-time-to-ship reporting.
-- ============================================================
ALTER TABLE items ADD COLUMN shipped_at INTEGER;
