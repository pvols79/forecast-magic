CREATE TABLE audit_clearances (
  account_key TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (account_key, transaction_id)
);

ALTER TABLE audit_transaction_observations ADD COLUMN settlement_json TEXT;
