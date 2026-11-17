-- Existing schedules retain their behavior. Newly enabled schedules record the
-- local activation date instead of treating fund creation as activation.
ALTER TABLE operational_funds ADD COLUMN schedule_started_on TEXT;

-- Retain a removal marker so projection replay cannot recreate deleted funding.
CREATE TABLE operational_fund_allocation_removals (
  fund_id INTEGER NOT NULL REFERENCES operational_funds(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  removed_at TEXT NOT NULL,
  PRIMARY KEY (fund_id, period_start)
);
