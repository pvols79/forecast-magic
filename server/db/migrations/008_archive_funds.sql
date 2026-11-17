ALTER TABLE operational_funds ADD COLUMN archived_at TEXT;
ALTER TABLE operational_funds ADD COLUMN archived_was_active INTEGER;
ALTER TABLE operational_funds ADD COLUMN archived_with_parent_id INTEGER;
ALTER TABLE operational_funds ADD COLUMN archived_remaining_cents INTEGER;
ALTER TABLE operational_funds ADD COLUMN archived_on TEXT;
