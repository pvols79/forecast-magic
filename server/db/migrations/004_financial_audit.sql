CREATE TABLE audit_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key TEXT NOT NULL,
  anchor_date TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence_score INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  source_freshness_json TEXT NOT NULL,
  summary_json TEXT NOT NULL
);

CREATE INDEX audit_runs_account_completed_idx
  ON audit_runs(account_key, completed_at DESC);

CREATE TABLE audit_transaction_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  account_key TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  source TEXT NOT NULL,
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  payee TEXT NOT NULL,
  original_payee TEXT,
  category_id INTEGER,
  recurring_id TEXT,
  is_pending INTEGER NOT NULL,
  is_n8n INTEGER NOT NULL,
  has_pending_tag INTEGER NOT NULL,
  tag_ids_json TEXT NOT NULL,
  tag_names_json TEXT NOT NULL,
  notes TEXT,
  external_id TEXT,
  created_at_api TEXT,
  updated_at_api TEXT,
  fingerprint TEXT NOT NULL
);

CREATE INDEX audit_transaction_observations_lookup_idx
  ON audit_transaction_observations(account_key, transaction_id, run_id DESC);

CREATE TABLE audit_balance_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER REFERENCES audit_runs(id) ON DELETE CASCADE,
  account_key TEXT NOT NULL,
  source TEXT NOT NULL,
  balance_kind TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL
);

CREATE INDEX audit_balance_observations_account_idx
  ON audit_balance_observations(account_key, observed_at DESC);

CREATE TABLE audit_statement_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key TEXT NOT NULL,
  source TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  coverage_start TEXT NOT NULL,
  coverage_end TEXT NOT NULL,
  closing_balance_cents INTEGER,
  imported_at TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  UNIQUE(account_key, content_sha256)
);

CREATE INDEX audit_statement_imports_account_idx
  ON audit_statement_imports(account_key, coverage_end DESC, imported_at DESC);

CREATE TABLE audit_statement_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER NOT NULL REFERENCES audit_statement_imports(id) ON DELETE CASCADE,
  row_key TEXT NOT NULL,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  balance_after_cents INTEGER,
  transaction_type TEXT,
  UNIQUE(import_id, row_key)
);

CREATE INDEX audit_statement_transactions_import_date_idx
  ON audit_statement_transactions(import_id, date);

CREATE TABLE audit_n8n_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key TEXT NOT NULL,
  external_id TEXT NOT NULL,
  email_id TEXT,
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  payee TEXT NOT NULL,
  statement_description TEXT,
  lunch_money_transaction_id TEXT,
  observed_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE(account_key, external_id)
);

CREATE INDEX audit_n8n_evidence_account_date_idx
  ON audit_n8n_evidence(account_key, date DESC);

CREATE TABLE audit_transaction_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key TEXT NOT NULL,
  left_source TEXT NOT NULL,
  left_id TEXT NOT NULL,
  right_source TEXT NOT NULL,
  right_id TEXT NOT NULL,
  relationship TEXT NOT NULL,
  confidence TEXT NOT NULL,
  details_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  UNIQUE(account_key, left_source, left_id, right_source, right_id, relationship)
);

CREATE INDEX audit_transaction_links_account_idx
  ON audit_transaction_links(account_key, observed_at DESC);

CREATE TABLE audit_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  finding_key TEXT NOT NULL,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  UNIQUE(run_id, finding_key)
);

CREATE INDEX audit_findings_run_severity_idx
  ON audit_findings(run_id, severity, category);
