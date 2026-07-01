CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  firstName TEXT NOT NULL,
  lastName TEXT NOT NULL,
  customerName TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  projectType TEXT,
  material TEXT,
  source TEXT,
  message TEXT,
  submittedAt TEXT NOT NULL,
  immediateEmailSentAt TEXT,
  feedbackEmailDueAt TEXT NOT NULL,
  feedbackEmailSentAt TEXT,
  feedbackEmailClaimedAt TEXT,
  feedbackStatus TEXT NOT NULL DEFAULT 'pending',
  feedbackEmailAttemptCount INTEGER NOT NULL DEFAULT 0,
  feedbackEmailLastError TEXT,
  rating INTEGER,
  feedbackComment TEXT,
  feedbackReceivedAt TEXT,
  feedbackSource TEXT,
  replyTokenHash TEXT NOT NULL UNIQUE,
  replyTokenExpiresAt TEXT NOT NULL,
  postmarkImmediateMessageId TEXT,
  postmarkFeedbackMessageId TEXT,
  ipHash TEXT,
  userAgent TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_feedback_due
  ON leads (feedbackEmailDueAt, feedbackEmailSentAt, feedbackStatus, feedbackEmailClaimedAt);

CREATE INDEX IF NOT EXISTS idx_leads_email
  ON leads (email);

CREATE INDEX IF NOT EXISTS idx_leads_ip_submitted
  ON leads (ipHash, submittedAt);

CREATE INDEX IF NOT EXISTS idx_leads_feedback_status
  ON leads (feedbackStatus, feedbackReceivedAt);

CREATE TABLE IF NOT EXISTS email_events (
  id TEXT PRIMARY KEY,
  leadId TEXT,
  eventType TEXT NOT NULL,
  recipient TEXT,
  subject TEXT,
  status TEXT NOT NULL,
  messageStream TEXT,
  postmarkMessageId TEXT,
  error TEXT,
  payloadJson TEXT,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (leadId) REFERENCES leads(id)
);

CREATE INDEX IF NOT EXISTS idx_email_events_lead
  ON email_events (leadId, eventType, createdAt);

CREATE INDEX IF NOT EXISTS idx_email_events_postmark
  ON email_events (postmarkMessageId);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  leadId TEXT NOT NULL,
  rating INTEGER,
  comment TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  rawMetadataJson TEXT,
  receivedAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (leadId) REFERENCES leads(id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_lead
  ON feedback (leadId, receivedAt);

CREATE TABLE IF NOT EXISTS postmark_inbound_events (
  id TEXT PRIMARY KEY,
  leadId TEXT,
  postmarkMessageId TEXT,
  fromEmail TEXT,
  mailboxHash TEXT,
  subject TEXT,
  rating INTEGER,
  status TEXT NOT NULL,
  rawJson TEXT,
  receivedAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (leadId) REFERENCES leads(id)
);

CREATE INDEX IF NOT EXISTS idx_postmark_inbound_lead
  ON postmark_inbound_events (leadId, receivedAt);

CREATE INDEX IF NOT EXISTS idx_postmark_inbound_message
  ON postmark_inbound_events (postmarkMessageId);

CREATE TABLE IF NOT EXISTS postmark_delivery_events (
  id TEXT PRIMARY KEY,
  leadId TEXT,
  eventType TEXT,
  messageId TEXT,
  recipient TEXT,
  receivedAt TEXT NOT NULL,
  rawJson TEXT,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (leadId) REFERENCES leads(id)
);

CREATE INDEX IF NOT EXISTS idx_postmark_delivery_lead
  ON postmark_delivery_events (leadId, receivedAt);

CREATE INDEX IF NOT EXISTS idx_postmark_delivery_message
  ON postmark_delivery_events (messageId);
