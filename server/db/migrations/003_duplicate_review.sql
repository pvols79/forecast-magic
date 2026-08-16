CREATE TABLE duplicate_review_ignored_pairs (
  manual_transaction_id TEXT NOT NULL,
  imported_transaction_id TEXT NOT NULL,
  account_key TEXT NOT NULL,
  ignored_at TEXT NOT NULL,
  PRIMARY KEY (manual_transaction_id, imported_transaction_id)
);

CREATE INDEX duplicate_review_ignored_account_idx
  ON duplicate_review_ignored_pairs(account_key, ignored_at);
