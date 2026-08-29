PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  supplier_id TEXT PRIMARY KEY,
  legal_name TEXT,
  trading_name TEXT,
  country_code TEXT,
  vat_id TEXT,
  canonical_domain TEXT,
  source_url TEXT,
  contact_url TEXT,
  status TEXT NOT NULL CHECK(status IN ('verified','not_verified','blocked')),
  fred_perry_priority TEXT NOT NULL DEFAULT 'unknown',
  contractual_resale_restriction TEXT NOT NULL DEFAULT 'unknown',
  restriction_resolution_status TEXT NOT NULL DEFAULT 'pending_contact',
  operational_purchase_status TEXT NOT NULL DEFAULT 'not_assessed',
  latest_decision_id TEXT,
  observed_at TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suppliers_status ON suppliers(status);
CREATE INDEX IF NOT EXISTS idx_suppliers_domain ON suppliers(canonical_domain);
CREATE INDEX IF NOT EXISTS idx_suppliers_vat ON suppliers(vat_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_country ON suppliers(country_code);

CREATE TABLE IF NOT EXISTS queue_jobs (
  job_id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  lane INTEGER NOT NULL CHECK(lane BETWEEN 1 AND 50),
  stage TEXT NOT NULL DEFAULT 'primary',
  status TEXT NOT NULL CHECK(status IN ('queued','enqueued','active','retry','manual_review','completed','failed','cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,
  rank INTEGER,
  domain TEXT,
  country_code TEXT,
  website_url TEXT NOT NULL,
  required_gates_json TEXT NOT NULL DEFAULT '[]',
  score_reasons_json TEXT NOT NULL DEFAULT '[]',
  attempts INTEGER NOT NULL DEFAULT 0,
  enqueued_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  next_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(supplier_id) REFERENCES suppliers(supplier_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_queue_status_priority ON queue_jobs(status, priority DESC, rank ASC);
CREATE INDEX IF NOT EXISTS idx_queue_domain ON queue_jobs(domain);
CREATE INDEX IF NOT EXISTS idx_queue_lane ON queue_jobs(lane, status);

CREATE TABLE IF NOT EXISTS worker_lanes (
  lane INTEGER PRIMARY KEY CHECK(lane BETWEEN 1 AND 50),
  status TEXT NOT NULL CHECK(status IN ('idle','enqueued','active','review','error','paused')),
  current_job_id TEXT,
  current_supplier_id TEXT,
  current_domain TEXT,
  heartbeat_at TEXT,
  processed INTEGER NOT NULL DEFAULT 0,
  reviews INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  last_duration_ms INTEGER,
  last_message TEXT
);

CREATE TABLE IF NOT EXISTS evidence (
  evidence_id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  job_id TEXT,
  evidence_type TEXT NOT NULL,
  source_url TEXT,
  http_status INTEGER,
  final_url TEXT,
  content_hash TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  excerpt TEXT,
  payload_json TEXT NOT NULL,
  FOREIGN KEY(supplier_id) REFERENCES suppliers(supplier_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_evidence_supplier ON evidence(supplier_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_job ON evidence(job_id);

CREATE TABLE IF NOT EXISTS decisions (
  decision_id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  job_id TEXT,
  decision TEXT NOT NULL CHECK(decision IN ('verified','not_verified','blocked','needs_more_evidence')),
  reason_codes_json TEXT NOT NULL DEFAULT '[]',
  actor_email TEXT,
  actor_type TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  previous_decision_id TEXT,
  decided_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(supplier_id) REFERENCES suppliers(supplier_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decisions_supplier ON decisions(supplier_id, decided_at DESC);

CREATE TABLE IF NOT EXISTS manual_reviews (
  review_id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','in_review','approved','rejected','blocked','needs_more_evidence')),
  reason TEXT,
  gate_summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(supplier_id, job_id),
  FOREIGN KEY(supplier_id) REFERENCES suppliers(supplier_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON manual_reviews(status, created_at);

CREATE TABLE IF NOT EXISTS activity (
  activity_id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at DESC);

CREATE TABLE IF NOT EXISTS dedupe_checks (
  dedupe_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_supplier_id TEXT,
  target_supplier_id TEXT,
  key_type TEXT,
  key_value TEXT,
  outcome TEXT,
  checked_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_dedupe_source ON dedupe_checks(source_supplier_id);
CREATE INDEX IF NOT EXISTS idx_dedupe_target ON dedupe_checks(target_supplier_id);

CREATE TABLE IF NOT EXISTS checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  batch_number INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES
 ('system_mode','paused',datetime('now')),
 ('canonical_batch','10',datetime('now')),
 ('target_verified','10000',datetime('now')),
 ('kb_records','0',datetime('now')),
 ('seed_import_complete','0',datetime('now'));

WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < 50)
INSERT OR IGNORE INTO worker_lanes(lane,status,heartbeat_at)
SELECT x,'idle',datetime('now') FROM n;
