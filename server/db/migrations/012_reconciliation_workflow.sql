CREATE TABLE reconciliation_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  decisions_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX reconciliation_sessions_account ON reconciliation_sessions(account_key, id DESC);
CREATE TABLE reconciliation_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES reconciliation_sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('capital_one','venmo','pending')),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  content BLOB NOT NULL,
  extracted_text TEXT NOT NULL,
  extraction_json TEXT NOT NULL,
  review_json TEXT,
  reviewed_at TEXT,
  uploaded_at TEXT NOT NULL,
  UNIQUE(session_id, kind, content_sha256)
);
CREATE TABLE reconciliation_workflow_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES reconciliation_sessions(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  completed_at TEXT NOT NULL,
  result_json TEXT NOT NULL
);
CREATE INDEX reconciliation_workflow_runs_session ON reconciliation_workflow_runs(session_id, id DESC);
