-- StudyCapital D1 Database Schema
-- Run with: wrangler d1 execute studycapital-leads --file=schema.sql

CREATE TABLE IF NOT EXISTS leads (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL,
  email        TEXT DEFAULT '',
  city         TEXT DEFAULT '',
  loanType     TEXT DEFAULT 'International',
  loanAmount   TEXT DEFAULT '',
  course       TEXT DEFAULT '',
  destination  TEXT DEFAULT '',
  source       TEXT DEFAULT 'Website',
  status       TEXT DEFAULT 'New',
  assignedTo   TEXT DEFAULT '',
  followup     TEXT DEFAULT '',
  message      TEXT DEFAULT '',
  notes        TEXT DEFAULT '[]',   -- JSON array of {text, date} objects
  createdAt    TEXT NOT NULL
);

-- Index for fast filtering by status and date
CREATE INDEX IF NOT EXISTS idx_leads_status    ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_createdAt ON leads(createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_leads_source    ON leads(source);
CREATE INDEX IF NOT EXISTS idx_leads_loanType  ON leads(loanType);
