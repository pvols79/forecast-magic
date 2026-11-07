ALTER TABLE operational_funds ADD COLUMN parent_id INTEGER REFERENCES operational_funds(id) ON DELETE RESTRICT;
ALTER TABLE operational_funds ADD COLUMN occasion_date TEXT;
ALTER TABLE operational_funds ADD COLUMN purchased_on TEXT;
CREATE TABLE operational_fund_adjustments (
  id INTEGER PRIMARY KEY,
  fund_id INTEGER NOT NULL REFERENCES operational_funds(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents != 0),
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX fund_adjustments_date ON operational_fund_adjustments(fund_id, date);
