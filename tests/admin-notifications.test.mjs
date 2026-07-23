import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_EVENT_PREFIX,
  buildCustomerReplyAlert,
  buildDeliveryProblemAlert,
  buildNewLeadAlert,
  buildNoLeadsAlert,
  buildWeeklyDigestAlert,
  claimNotificationSlot,
  COOLDOWNS,
  isAdminNotificationEvent,
  isDeliveryProblem,
  isUnansweredReply,
  NOTIFICATION_TYPES,
  sendAdminNotification,
  summarizeLeadWindow
} from '../src/admin-notifications.mjs';
import { ADMIN_EMAILS, notificationRecipients } from '../src/admin-accounts.mjs';
import { isLowRating, renderInternalFeedbackNotificationEmail } from '../src/email/render.mjs';

const ENV = { PUBLIC_SITE_URL: 'https://stonebellisimollc.com' };

test('alerts reach the admin allowlist and can be redirected or muted', () => {
  assert.deepEqual(notificationRecipients({}), ADMIN_EMAILS.map(email => email.toLowerCase()));

  // SB_ADMIN_EMAILS extends the allowlist, so it extends the recipients too.
  assert.ok(notificationRecipients({ SB_ADMIN_EMAILS: 'new@example.com' }).includes('new@example.com'));

  // An explicit override replaces the default rather than adding to it.
  assert.deepEqual(
    notificationRecipients({ SB_NOTIFY_EMAILS: 'Alerts@Example.com, ops@example.com' }),
    ['alerts@example.com', 'ops@example.com']
  );

  // Muting yields nobody rather than silently falling back to the allowlist.
  assert.deepEqual(notificationRecipients({ ADMIN_NOTIFICATIONS_ENABLED: 'false' }), []);
});

test('a failing alert cannot alert about itself', () => {
  for (const type of Object.values(NOTIFICATION_TYPES)) {
    assert.ok(type.startsWith(ADMIN_EVENT_PREFIX), `${type} must carry the guard prefix`);
    assert.equal(isAdminNotificationEvent(type), true);
  }
  // Customer-facing sends still raise a failure alert; only our own do not.
  assert.equal(isAdminNotificationEvent('immediate_confirmation'), false);
  assert.equal(isAdminNotificationEvent('internal_feedback_notification'), false);
  assert.equal(isAdminNotificationEvent(undefined), false);
});

test('the new lead alert carries what someone needs to return the call', () => {
  const alert = buildNewLeadAlert({
    id: 'lead_123',
    customerName: 'Dana Rivera',
    phone: '201-555-0142',
    email: 'dana@example.com',
    projectType: 'Kitchen countertops',
    material: 'Quartz',
    message: 'Looking for an estimate.',
    submittedAt: '2026-07-20T15:04:00.000Z',
    source: 'Website Contact Form',
    attribution: { landingPage: '/kitchens', utmSource: 'google', deviceCategory: 'mobile' }
  }, ENV);

  assert.match(alert.subject, /Dana Rivera/);
  assert.match(alert.text, /201-555-0142/);
  assert.match(alert.text, /Kitchen countertops/);
  assert.match(alert.text, /\/kitchens/);
  // The fastest action on a countertop lead is a phone call, so that is the CTA.
  assert.match(alert.html, /tel:2015550142/);
});

test('rendered alerts escape customer supplied content', () => {
  const alert = buildNewLeadAlert({
    customerName: '<script>alert(1)</script>',
    message: 'Quote "now" & <b>bold</b>'
  }, ENV);

  assert.ok(!alert.html.includes('<script>'));
  assert.match(alert.html, /&lt;script&gt;/);
  assert.match(alert.html, /&amp;/);
});

test('only delivery failures that need a human are escalated', () => {
  assert.equal(isDeliveryProblem({ eventType: 'Delivery' }), false);
  assert.equal(isDeliveryProblem({ eventType: 'Open' }), false);
  assert.equal(isDeliveryProblem({ eventType: 'SpamComplaint' }), true);
  assert.equal(isDeliveryProblem({ eventType: 'SubscriptionChange' }), true);

  // Postmark retries transient bounces on its own; only hard failures alert.
  assert.equal(isDeliveryProblem({ eventType: 'Bounce', rawJson: '{"Type":"Transient"}' }), false);
  assert.equal(isDeliveryProblem({ eventType: 'Bounce', rawJson: '{"Type":"HardBounce"}' }), true);
  // Unparseable payloads must not crash the trigger.
  assert.equal(isDeliveryProblem({ eventType: 'Bounce', rawJson: 'not json' }), true);

  const alert = buildDeliveryProblemAlert({
    eventType: 'Bounce',
    recipient: 'typo@exmaple.com',
    rawJson: '{"Type":"HardBounce","Description":"The address does not exist."}'
  }, ENV);
  assert.match(alert.subject, /typo@exmaple.com/);
  assert.match(alert.text, /does not exist/);
});

test('only inbound replies that failed to match a lead are escalated', () => {
  // Matched replies already notify through the feedback path; alerting here too
  // would send two emails for one reply.
  assert.equal(isUnansweredReply({ status: 'parsed' }), false);
  assert.equal(isUnansweredReply({ status: 'unparsed' }), false);
  assert.equal(isUnansweredReply({ status: 'duplicate' }), false);
  assert.equal(isUnansweredReply({ status: 'unmatched' }), true);
  assert.equal(isUnansweredReply({ status: 'invalid_reference' }), true);
  assert.equal(isUnansweredReply({ status: 'expired_reference' }), true);

  const alert = buildCustomerReplyAlert({
    status: 'unmatched',
    fromEmail: 'dana@example.com',
    subject: 'Re: your estimate',
    rawJson: JSON.stringify({ TextBody: 'Can we reschedule for Friday?' })
  }, ENV);
  assert.match(alert.text, /reschedule for Friday/);
  assert.match(alert.html, /mailto:dana@example.com/);
});

test('low ratings get their own subject and urgency', () => {
  assert.equal(isLowRating(1), true);
  assert.equal(isLowRating(3), true);
  assert.equal(isLowRating(4), false);
  assert.equal(isLowRating(null), false);
  assert.equal(isLowRating(0), false);

  const lead = { customerName: 'Dana Rivera', phone: '201-555-0142', email: 'dana@example.com' };
  const low = renderInternalFeedbackNotificationEmail({
    lead,
    feedback: { rating: 2, comment: 'Slow to respond.', source: 'feedback_form' },
    baseUrl: ENV.PUBLIC_SITE_URL
  });
  assert.match(low.subject, /Low rating/);
  assert.match(low.html, /Needs attention/);
  assert.match(low.html, /tel:2015550142/);

  const happy = renderInternalFeedbackNotificationEmail({
    lead,
    feedback: { rating: 5, comment: 'Beautiful work.', source: 'feedback_form' },
    baseUrl: ENV.PUBLIC_SITE_URL
  });
  assert.doesNotMatch(happy.subject, /Low rating/);
  assert.doesNotMatch(happy.html, /Needs attention/);
});

test('the digest counts real demand and ignores QA traffic', () => {
  const summary = summarizeLeadWindow([
    { source: 'Website Contact Form', projectType: 'Kitchen', rating: 5, feedbackReceivedAt: '2026-07-19T00:00:00.000Z', attribution: { utmSource: 'google' } },
    { source: 'Website Contact Form', projectType: 'Kitchen', rating: 2, feedbackReceivedAt: '2026-07-19T00:00:00.000Z' },
    { source: 'Phone', projectType: 'Bathroom' },
    { source: 'Website Contact Form', attribution: { trafficClass: 'test' } }
  ]);

  assert.equal(summary.total, 3);
  assert.equal(summary.testExcluded, 1);
  assert.deepEqual(summary.bySource[0], ['Website Contact Form', 2]);
  assert.equal(summary.ratingCount, 2);
  assert.equal(summary.averageRating, 3.5);
  assert.equal(summary.lowRatings, 1);
  assert.equal(summary.awaitingFeedback, 1);

  const alert = buildWeeklyDigestAlert({
    summary,
    since: '2026-07-13T12:00:00.000Z',
    until: '2026-07-20T12:00:00.000Z'
  }, ENV);
  assert.match(alert.subject, /3 new leads/);
  assert.match(alert.text, /average 3.5\/5/);
});

test('the watchdog alert names the silence it found', () => {
  const alert = buildNoLeadsAlert({ hours: 72, lastLead: { customerName: 'Dana Rivera', submittedAt: '2026-07-15T12:00:00.000Z' } }, ENV);
  assert.match(alert.subject, /No new leads in 72 hours/);
  assert.match(alert.text, /Dana Rivera/);

  const empty = buildNoLeadsAlert({ hours: 72, lastLead: null }, ENV);
  assert.match(empty.text, /None on record/);
});

// Firestore delivers triggers at least once, so redelivery must not resend.
test('a notification slot is claimed once per cooldown window', async () => {
  const documents = new Map();
  const db = {
    collection: () => ({ doc: key => ({ key }) }),
    async runTransaction(handler) {
      return handler({
        get: async reference => ({
          exists: documents.has(reference.key),
          data: () => documents.get(reference.key)
        }),
        set: (reference, value) => documents.set(reference.key, value)
      });
    }
  };

  const start = 1_800_000_000_000;
  assert.equal(await claimNotificationSlot(db, 'lead:abc', COOLDOWNS.perDocument, start), true);
  assert.equal(await claimNotificationSlot(db, 'lead:abc', COOLDOWNS.perDocument, start + 1000), false);
  // A different document is unaffected by the first claim.
  assert.equal(await claimNotificationSlot(db, 'lead:xyz', COOLDOWNS.perDocument, start + 1000), true);
  // Once the window passes, the rate-limited alerts may fire again.
  assert.equal(await claimNotificationSlot(db, 'email_failure', COOLDOWNS.emailFailure, start), true);
  assert.equal(await claimNotificationSlot(db, 'email_failure', COOLDOWNS.emailFailure, start + COOLDOWNS.emailFailure + 1), true);

  // Bookkeeping trouble must never swallow a real alert.
  const brokenDb = { collection: () => ({ doc: () => ({}) }), runTransaction: async () => { throw new Error('unavailable'); } };
  assert.equal(await claimNotificationSlot(brokenDb, 'lead:abc', COOLDOWNS.perDocument, start), true);
});

test('sending an alert never throws and records one event for the group', async () => {
  const saved = [];
  const store = { saveEmailEvent: async event => { saved.push(event); } };
  const env = { ...ENV, POSTMARK_MOCK_MODE: 'true' };

  const result = await sendAdminNotification({
    env,
    store,
    type: NOTIFICATION_TYPES.newLead,
    alert: buildNewLeadAlert({ id: 'lead_1', customerName: 'Dana Rivera' }, env),
    lead: { id: 'lead_1' },
    replyTo: 'dana@example.com'
  });

  assert.equal(result.sent, true);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].eventType, NOTIFICATION_TYPES.newLead);
  assert.equal(saved[0].recipient, ADMIN_EMAILS.join(', '));

  // A Postmark outage is logged, not thrown, so the trigger still completes.
  const failing = { saveEmailEvent: async () => { throw new Error('firestore down'); } };
  const failed = await sendAdminNotification({
    env,
    store: failing,
    type: NOTIFICATION_TYPES.newLead,
    alert: buildNewLeadAlert({ id: 'lead_1' }, env)
  });
  assert.equal(failed.sent, false);

  // With nobody to tell, sending is skipped rather than attempted.
  const muted = await sendAdminNotification({
    env: { ...env, ADMIN_NOTIFICATIONS_ENABLED: 'false' },
    store,
    type: NOTIFICATION_TYPES.newLead,
    alert: buildNewLeadAlert({ id: 'lead_1' }, env)
  });
  assert.equal(muted.reason, 'no_recipients');
  assert.equal(saved.length, 1);
});
