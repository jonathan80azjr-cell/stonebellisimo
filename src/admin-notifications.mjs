// Staff-facing alerts. Everything here is best-effort: a notification that
// cannot be built or sent must never break the customer request or the trigger
// that raised it, so every entry point swallows its own errors after logging.
import { notificationRecipients } from './admin-accounts.mjs';
import { BUSINESS_INFO, renderInternalAlertEmail } from './email/render.mjs';
import { getEnv, nowIso, sendAndRecordEmail } from './lead-automation.mjs';

// Every alert this module sends is recorded in `email_events` under a type
// carrying this prefix. The email_events trigger skips them, which is what
// stops "the alert email failed" from raising another alert forever.
export const ADMIN_EVENT_PREFIX = 'admin_';

export const NOTIFICATION_TYPES = Object.freeze({
  newLead: 'admin_new_lead',
  customerReply: 'admin_customer_reply',
  deliveryProblem: 'admin_delivery_problem',
  emailFailure: 'admin_email_failure',
  noLeads: 'admin_no_leads',
  weeklyDigest: 'admin_weekly_digest',
  searchConsoleFailure: 'admin_search_console_failure'
});

const NOTIFICATION_STATE_COLLECTION = 'admin_notification_state';
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Firestore triggers are at-least-once, so per-document alerts use a long
// window purely to deduplicate redelivery. The rate-limited alerts (a Postmark
// outage, a silent form) use a window chosen to be useful rather than noisy.
export const COOLDOWNS = Object.freeze({
  perDocument: 7 * DAY,
  emailFailure: HOUR,
  noLeads: DAY,
  // The import retries daily on its own. Alerting every single day about a
  // permission grant nobody has done yet trains staff to ignore the alert, so
  // the dashboard carries the persistent state and email only nudges.
  searchConsoleFailure: 3 * DAY
});

export function isAdminNotificationEvent(eventType) {
  return String(eventType || '').startsWith(ADMIN_EVENT_PREFIX);
}

function siteUrl(env) {
  return getEnv(env, 'PUBLIC_SITE_URL', BUSINESS_INFO.website).replace(/\/+$/, '');
}

function dashboardUrl(env) {
  return `${siteUrl(env)}/admin/`;
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

// Only claim the slot when the alert is actually due. The write and the read
// share a transaction so two concurrent trigger retries cannot both send.
export async function claimNotificationSlot(db, key, cooldownMs, nowMs) {
  if (!db || !key) return true;
  const reference = db.collection(NOTIFICATION_STATE_COLLECTION).doc(String(key).replace(/\//g, '_').slice(0, 400));
  try {
    return await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      const lastSentAtMs = snapshot.exists ? Number(snapshot.data()?.lastSentAtMs || 0) : 0;
      if (lastSentAtMs && nowMs - lastSentAtMs < cooldownMs) return false;
      transaction.set(reference, {
        key,
        lastSentAtMs: nowMs,
        lastSentAt: new Date(nowMs).toISOString()
      });
      return true;
    });
  } catch (error) {
    // A bookkeeping failure should not silence a real alert.
    console.error(JSON.stringify({ message: 'Notification slot claim failed', key, error: error?.message || String(error) }));
    return true;
  }
}

export async function sendAdminNotification({ env, store, type, alert, lead = null, replyTo = '', metadata = {} }) {
  const recipients = notificationRecipients(env);
  if (!recipients.length) {
    console.info(JSON.stringify({ message: 'Admin notification skipped: no recipients', type }));
    return { sent: false, reason: 'no_recipients' };
  }

  try {
    await sendAndRecordEmail({
      env,
      store,
      lead,
      eventType: type,
      email: {
        ...alert,
        to: recipients.join(', '),
        ...(replyTo ? { replyTo } : {}),
        metadata: {
          email_type: type,
          ...(lead?.id ? { lead_id: lead.id } : {}),
          ...Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, String(value ?? '')]))
        }
      }
    });
    return { sent: true, recipients };
  } catch (error) {
    console.error(JSON.stringify({ message: 'Admin notification failed', type, error: error?.message || String(error) }));
    return { sent: false, reason: 'send_failed' };
  }
}

export function buildNewLeadAlert(lead = {}, env = {}) {
  const name = lead.customerName || `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'A new visitor';
  const attribution = lead.attribution || {};
  const campaign = [attribution.utmSource, attribution.utmMedium, attribution.utmCampaign].filter(Boolean).join(' / ');

  return renderInternalAlertEmail({
    eyebrow: 'New lead',
    title: `New lead: ${name}`,
    intro: `${name} just submitted the ${lead.source || 'website'} form. Reply to this email to answer them directly.`,
    rows: [
      ['Name', name],
      ['Phone', lead.phone],
      ['Email', lead.email],
      ['Project type', lead.projectType],
      ['Material', lead.material],
      ['Message', lead.message],
      ['Submitted', formatDateTime(lead.submittedAt)],
      ['Landing page', attribution.landingPage],
      ['Campaign', campaign],
      ['Referrer', attribution.referrerHost],
      ['Device', attribution.deviceCategory && attribution.deviceCategory !== 'unknown' ? attribution.deviceCategory : '']
    ],
    ctaLabel: lead.phone ? `Call ${lead.phone}` : 'Open dashboard',
    ctaUrl: lead.phone ? `tel:${String(lead.phone).replace(/[^0-9+]/g, '')}` : dashboardUrl(env),
    note: `Lead ${lead.id || ''} - open the dashboard at ${dashboardUrl(env)} for full history.`
  });
}

// A reply that matches its lead already raises a feedback notification from
// lead-automation.mjs. These three statuses are the ones that reach Firestore
// and stop there: a real person wrote back and no human is told.
const UNANSWERED_REPLY_STATUSES = Object.freeze(['unmatched', 'invalid_reference', 'expired_reference']);

const REPLY_REASONS = Object.freeze({
  unmatched: 'It carried no lead reference, so it could not be linked to a customer automatically.',
  invalid_reference: 'Its lead reference did not validate, so it was not linked to a customer.',
  expired_reference: 'Its reply link had expired, so the feedback was not recorded.'
});

export function isUnansweredReply(event = {}) {
  return UNANSWERED_REPLY_STATUSES.includes(String(event.status || ''));
}

export function buildCustomerReplyAlert(event = {}, env = {}) {
  const payload = parsePayload(event);
  const from = event.fromEmail || payload.From || 'a customer';
  const body = payload.StrippedTextReply || payload.TextBody || '';

  return renderInternalAlertEmail({
    eyebrow: 'Unanswered reply',
    tone: 'urgent',
    title: `Email reply from ${from} needs a human`,
    intro: `${from} replied to one of our emails. ${REPLY_REASONS[event.status] || ''} Nobody has answered it.`,
    rows: [
      ['From', from],
      ['Subject', event.subject],
      ['Message', body.slice(0, 2000)],
      ['Reason', event.status],
      ['Lead reference', event.leadId],
      ['Received', formatDateTime(event.receivedAt)]
    ],
    ctaLabel: from.includes('@') ? `Reply to ${from}` : 'Open dashboard',
    ctaUrl: from.includes('@') ? `mailto:${from}` : dashboardUrl(env)
  });
}

// Low ratings are escalated inside renderInternalFeedbackNotificationEmail
// rather than here, so lead-automation.mjs does not have to import this module
// back and create a cycle.

// Postmark record types that mean the customer never got the mail. Transient
// types (Delivery, Open, Click) are stored but not alerted on.
const DELIVERY_PROBLEM_TYPES = Object.freeze(['Bounce', 'SpamComplaint', 'SubscriptionChange']);

export function isDeliveryProblem(event = {}) {
  const type = String(event.eventType || '');
  if (!DELIVERY_PROBLEM_TYPES.includes(type)) return false;
  // A soft bounce that Postmark will retry is not yet a problem worth an email.
  if (type === 'Bounce' && parsePayload(event).Type === 'Transient') return false;
  return true;
}

function parsePayload(event = {}) {
  try {
    return JSON.parse(event.rawJson || '{}') || {};
  } catch {
    return {};
  }
}

export function buildDeliveryProblemAlert(event = {}, env = {}) {
  const payload = parsePayload(event);
  const type = String(event.eventType || 'Delivery problem');
  const readable = type === 'SpamComplaint'
    ? 'marked our email as spam'
    : type === 'SubscriptionChange'
      ? 'unsubscribed from our email'
      : 'did not receive our email';

  return renderInternalAlertEmail({
    eyebrow: 'Email problem',
    tone: 'urgent',
    title: `${type}: ${event.recipient || 'a customer'}`,
    intro: `${event.recipient || 'A customer'} ${readable}. Reach them by phone instead of replying by email.`,
    rows: [
      ['Recipient', event.recipient],
      ['Problem', type],
      ['Reason', payload.Description || payload.Details || payload.Name],
      ['Lead', event.leadId],
      ['Received', formatDateTime(event.receivedAt)]
    ],
    ctaLabel: 'Open dashboard',
    ctaUrl: dashboardUrl(env)
  });
}

export function buildEmailFailureAlert(event = {}, env = {}) {
  return renderInternalAlertEmail({
    eyebrow: 'System alert',
    tone: 'urgent',
    title: 'Automated email failed to send',
    intro: 'Postmark rejected an outgoing message. If this repeats, customer confirmations and feedback requests are silently not being delivered.',
    rows: [
      ['Email type', event.eventType],
      ['Recipient', event.recipient],
      ['Subject', event.subject],
      ['Error', event.error],
      ['Lead', event.leadId],
      ['Failed at', formatDateTime(event.createdAt)]
    ],
    ctaLabel: 'Open dashboard',
    ctaUrl: dashboardUrl(env),
    note: `Further send failures are suppressed for ${COOLDOWNS.emailFailure / MINUTE} minutes so an outage cannot flood this inbox.`
  });
}

export function buildNoLeadsAlert({ hours, lastLead = null }, env = {}) {
  return renderInternalAlertEmail({
    eyebrow: 'System alert',
    tone: 'urgent',
    title: `No new leads in ${hours} hours`,
    intro: 'Nothing has come through the contact form for longer than usual. This is normally quiet demand, but it is also what a broken form looks like, so it is worth submitting a test request.',
    rows: [
      ['Last lead', lastLead ? formatDateTime(lastLead.submittedAt) : 'None on record'],
      ['Last customer', lastLead?.customerName],
      ['Quiet for', `${hours} hours`]
    ],
    ctaLabel: 'Test the contact form',
    ctaUrl: `${siteUrl(env)}/#contact`
  });
}

// A 403 here is a one-time grant somebody forgot, not a code fault, so the
// alert leads with the fix rather than the stack.
const SEARCH_CONSOLE_REMEDIES = Object.freeze({
  401: 'The Functions runtime credentials were rejected. Confirm the service account still exists and Application Default Credentials are intact.',
  403: 'Add the Functions service account as a user on the Search Console property, then wait for the next 5:15 AM run.',
  404: 'The configured property does not exist under that exact site URL. A domain property must be written as sc-domain:example.com.'
});

export function buildSearchConsoleFailureAlert({ errorCode, consecutiveFailures, lastSuccessAt, siteUrl, serviceAccount }, env = {}) {
  const remedy = SEARCH_CONSOLE_REMEDIES[errorCode]
    || 'Check the importSearchConsoleSchedule logs in Cloud Logging for the failing request.';

  return renderInternalAlertEmail({
    eyebrow: 'System alert',
    tone: 'urgent',
    title: 'Search Console import is failing',
    intro: `The daily Google Search Console import failed${consecutiveFailures > 1 ? ` ${consecutiveFailures} times in a row` : ''}. Organic search numbers on the dashboard are frozen until this is fixed. ${remedy}`,
    rows: [
      ['Error', errorCode ? String(errorCode) : 'Unknown'],
      ['Consecutive failures', consecutiveFailures ? String(consecutiveFailures) : ''],
      ['Last successful import', lastSuccessAt ? formatDateTime(lastSuccessAt) : 'Never'],
      ['Property', siteUrl],
      ['Service account', serviceAccount],
      ['What to do', remedy]
    ],
    ctaLabel: 'Open dashboard',
    ctaUrl: dashboardUrl(env),
    note: `Further Search Console alerts are suppressed for ${COOLDOWNS.searchConsoleFailure / DAY} days. The dashboard shows the live state in the meantime.`
  });
}

// Test traffic is excluded here for the same reason it is excluded from the
// dashboard: a QA submission should never show up as demand.
export function summarizeLeadWindow(leads = []) {
  const real = leads.filter(lead => (lead.attribution?.trafficClass || 'production') !== 'test');
  const rated = real.filter(lead => Number(lead.rating) > 0);
  const ratingTotal = rated.reduce((sum, lead) => sum + Number(lead.rating), 0);

  const tally = (values) => {
    const counts = new Map();
    for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
    return [...counts.entries()].sort((left, right) => right[1] - left[1]);
  };

  return {
    total: real.length,
    testExcluded: leads.length - real.length,
    bySource: tally(real.map(lead => lead.source)),
    byProjectType: tally(real.map(lead => lead.projectType).filter(value => value && value !== 'Not specified')),
    byCampaign: tally(real.map(lead => lead.attribution?.utmSource).filter(Boolean)),
    ratingCount: rated.length,
    averageRating: rated.length ? Math.round((ratingTotal / rated.length) * 10) / 10 : null,
    lowRatings: rated.filter(lead => Number(lead.rating) <= 3).length,
    awaitingFeedback: real.filter(lead => !lead.feedbackReceivedAt).length
  };
}

function formatTally(entries, limit = 5) {
  if (!entries.length) return '';
  return entries.slice(0, limit).map(([label, count]) => `${label}: ${count}`).join('\n');
}

export function buildWeeklyDigestAlert({ summary, since, until }, env = {}) {
  const headline = summary.total === 1 ? '1 new lead' : `${summary.total} new leads`;

  return renderInternalAlertEmail({
    eyebrow: 'Weekly summary',
    title: `Last week: ${headline}`,
    intro: `Stone Bellisimo activity from ${formatDateTime(since)} to ${formatDateTime(until)}.`,
    rows: [
      ['New leads', String(summary.total)],
      ['By source', formatTally(summary.bySource)],
      ['By project', formatTally(summary.byProjectType)],
      ['By campaign', formatTally(summary.byCampaign)],
      ['Ratings received', summary.ratingCount ? `${summary.ratingCount} (average ${summary.averageRating}/5)` : 'None'],
      ['Low ratings', summary.lowRatings ? String(summary.lowRatings) : ''],
      ['Awaiting feedback', String(summary.awaitingFeedback)],
      ['Test submissions excluded', summary.testExcluded ? String(summary.testExcluded) : '']
    ],
    ctaLabel: 'Open dashboard',
    ctaUrl: dashboardUrl(env)
  });
}
