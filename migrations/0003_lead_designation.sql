ALTER TABLE leads ADD COLUMN designation TEXT;
ALTER TABLE leads ADD COLUMN emailIssue INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_leads_designation
  ON leads (designation);
