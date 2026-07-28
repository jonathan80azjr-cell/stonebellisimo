ALTER TABLE leads ADD COLUMN businessStatus TEXT NOT NULL DEFAULT 'new';
ALTER TABLE leads ADD COLUMN clientChargeCents INTEGER;
ALTER TABLE leads ADD COLUMN biteSitesShareCents INTEGER;
ALTER TABLE leads ADD COLUMN biteSitesRateBps INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE leads ADD COLUMN completedAt TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_business_status
  ON leads (businessStatus, completedAt);
