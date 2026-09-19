export const LEAD_DESIGNATIONS = Object.freeze([
  { value: 'new', label: 'New' },
  { value: 'progress_completed', label: 'Progress Completed' },
  { value: 'needs_feedback', label: 'Needs Feedback' },
  { value: 'feedback_sent', label: 'Feedback Sent' },
  { value: 'feedback_received', label: 'Feedback Received' },
  { value: 'email_issue', label: 'Email Issue' }
]);

export const LEAD_DESIGNATION_VALUES = new Set(LEAD_DESIGNATIONS.map(item => item.value));
export const LEAD_DESIGNATION_LABELS = Object.freeze(Object.fromEntries(LEAD_DESIGNATIONS.map(item => [item.value, item.label])));

const LEGACY_DESIGNATION_ALIASES = Object.freeze({
  completed: 'progress_completed',
  email_failed: 'email_issue'
});

export function normalizeLeadDesignation(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return LEGACY_DESIGNATION_ALIASES[normalized] || normalized;
}

export function derivedLeadDesignation(lead = {}) {
  const explicit = normalizeLeadDesignation(lead.designation);
  if (LEAD_DESIGNATION_VALUES.has(explicit)) return explicit;
  if (lead.feedbackEmailLastError || lead.emailIssue) return 'email_issue';
  if (['received', 'unparsed'].includes(lead.feedbackStatus)) return 'feedback_received';
  if (lead.feedbackEmailSentAt) return 'feedback_sent';
  if (lead.businessStatus === 'completed') return 'progress_completed';
  if (['pending', 'sending'].includes(lead.feedbackStatus) && lead.feedbackEmailDueAt && !lead.feedbackEmailSentAt) return 'needs_feedback';
  return 'new';
}

export function leadHasDesignation(lead, designation) {
  const normalized = normalizeLeadDesignation(designation);
  return normalized === 'all' || derivedLeadDesignation(lead) === normalized;
}
