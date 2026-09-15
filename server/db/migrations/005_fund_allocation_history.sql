CREATE TABLE operational_fund_allocation_history (
  fund_id INTEGER NOT NULL REFERENCES operational_funds(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  allocation_cents INTEGER NOT NULL,
  carry_in_cents INTEGER NOT NULL,
  PRIMARY KEY (fund_id, period_start)
);
