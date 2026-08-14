CREATE TABLE application_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE operational_funds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key TEXT NOT NULL,
  name TEXT NOT NULL,
  allocation_cents INTEGER NOT NULL CHECK (allocation_cents >= 0),
  period_type TEXT NOT NULL CHECK (period_type IN ('weekly', 'monthly', 'quarterly', 'yearly', 'all-time')),
  weekly_start_day INTEGER CHECK (weekly_start_day BETWEEN 0 AND 6),
  anchor_month INTEGER CHECK (anchor_month BETWEEN 1 AND 12),
  anchor_day INTEGER CHECK (anchor_day BETWEEN 1 AND 31),
  rollover_mode TEXT NOT NULL CHECK (rollover_mode IN ('none', 'full', 'capped')),
  rollover_cap_cents INTEGER CHECK (rollover_cap_cents IS NULL OR rollover_cap_cents >= 0),
  target_cents INTEGER CHECK (target_cents IS NULL OR target_cents >= 0),
  household_visible INTEGER NOT NULL DEFAULT 0 CHECK (household_visible IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_on TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX operational_funds_account_idx ON operational_funds(account_key, active);

CREATE TABLE operational_fund_categories (
  fund_id INTEGER NOT NULL REFERENCES operational_funds(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL,
  PRIMARY KEY (fund_id, category_id)
);

CREATE INDEX operational_fund_categories_category_idx
  ON operational_fund_categories(category_id);

CREATE TABLE operational_fund_exclusions (
  fund_id INTEGER NOT NULL REFERENCES operational_funds(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (fund_id, transaction_id)
);

CREATE TABLE operational_fund_current_state (
  fund_id INTEGER PRIMARY KEY REFERENCES operational_funds(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT,
  allocation_cents INTEGER NOT NULL CHECK (allocation_cents >= 0),
  carry_in_cents INTEGER NOT NULL DEFAULT 0 CHECK (carry_in_cents >= 0),
  remaining_cents INTEGER NOT NULL CHECK (remaining_cents >= 0),
  calculated_through TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
