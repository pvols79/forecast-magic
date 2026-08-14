ALTER TABLE operational_funds
  ADD COLUMN fund_type TEXT NOT NULL DEFAULT 'operating'
  CHECK (fund_type IN ('operating', 'reserved', 'sinking'));

ALTER TABLE operational_funds
  ADD COLUMN allocation_mode TEXT NOT NULL DEFAULT 'scheduled'
  CHECK (allocation_mode IN ('manual', 'scheduled'));

ALTER TABLE operational_funds
  ADD COLUMN initial_balance_cents INTEGER NOT NULL DEFAULT 0
  CHECK (initial_balance_cents >= 0);

UPDATE operational_funds
SET fund_type = 'reserved',
    allocation_mode = 'manual',
    initial_balance_cents = allocation_cents
WHERE period_type = 'all-time';
