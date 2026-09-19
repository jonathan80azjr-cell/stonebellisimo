import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReviewToken,
  handleContactRequest,
  handleGoogleReviewRedirectRequest,
  processDueFeedbackEmails,
  sha256Hex
} from '../src/lead-automation.mjs';
import { createFirestoreStore } from '../src/firebase-store.mjs';
import { renderGoogleReviewRequestEmail } from '../src/email/render.mjs';

const env = { FEEDBACK_TOKEN_SECRET: 'review-flow-test-secret', POSTMARK_MOCK_MODE: 'true', PUBLIC_SITE_URL: 'https://stonebellisimollc.com' };

function transactionDb(seed = {}) {
  const collections = new Map(Object.entries(seed).map(([name, values]) => [name, new Map(Object.entries(values))]));
  const reference = (name, id) => ({ name, id });
  const read = ref => collections.get(ref.name)?.get(ref.id);
  const write = (ref, value, merge) => {
    const collection = collections.get(ref.name) || new Map();
    collections.set(ref.name, collection);
    collection.set(ref.id, merge ? { ...(collection.get(ref.id) || {}), ...value } : value);
  };
  return {
    collection: name => ({ doc: id => reference(name, id) }),
    runTransaction: async callback => callback({
      get: async ref => {
        const value = read(ref);
        return { exists: value !== undefined, data: () => value && { ...value } };
      },
      update: (ref, value) => write(ref, { ...(read(ref) || {}), ...value }, false),
      set: (ref, value, options = {}) => write(ref, value, options.merge === true)
    }),
    value: (name, id) => collections.get(name)?.get(id)
  };
}

test('new contact leads do not enter the legacy form-age feedback scheduler', async () => {
  let created;
  const store = {
    countRecentByIpHash: async () => 0,
    createLead: async lead => { created = lead; },
    saveEmailEvent: async () => {},
    markImmediateEmailSent: async () => {}
  };
  const response = await handleContactRequest(new Request('https://stonebellisimollc.com/api/contact', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firstName: 'Ada', lastName: 'Stone', email: 'ada@example.com', phone: '2015550101' })
  }), env, { store });
  assert.equal(response.status, 200);
  assert.equal(created.feedbackEmailDueAt, null);
  assert.equal(created.reviewRequestDueAt, null);
  assert.equal(created.salesStatus, 'New Lead');
  assert.equal(created.businessStatus, 'new');
  assert.equal(created.stageTimestamps.newLeadAt, created.submittedAt);
});

test('controlled organic attribution is promoted into canonical lead fields', async () => {
  let created;
  const store = {
    countRecentByIpHash: async () => 0,
    createLead: async lead => { created = lead; },
    saveEmailEvent: async () => {},
    markImmediateEmailSent: async () => {}
  };
  const attribution = {
    visitorId: 'visitor_1', sessionId: 'session_1', landingPage: '/contact-us/',
    utmSource: 'instagram', utmMedium: 'organic_social', utmCampaign: 'sb_organic_202608',
    utmContent: 'sb-202608-01-bio', deviceCategory: 'mobile'
  };
  const response = await handleContactRequest(new Request('https://stonebellisimollc.com/api/contact', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firstName: 'Ada', lastName: 'Stone', email: 'ada@example.com', phone: '2015550101', attribution })
  }), env, { store, sanitizeAttribution: value => value });
  assert.equal(response.status, 200);
  assert.equal(created.sourcePlatform, 'instagram');
  assert.equal(created.sourceContentId, 'sb-202608-01-bio');
  assert.equal(created.firstTouch.campaign, 'sb_organic_202608');
  assert.deepEqual(created.lastTouch, created.firstTouch);
});

test('a Google Business Profile click days earlier still earns the lead credit', async () => {
  // The scenario the persisted first touch exists for: the customer clicks the
  // profile's website button on Monday and submits the estimate form on
  // Thursday, by which point the session-scoped campaign tags are long gone.
  let created;
  const store = {
    countRecentByIpHash: async () => 0,
    createLead: async lead => { created = lead; },
    saveEmailEvent: async () => {},
    markImmediateEmailSent: async () => {}
  };
  const attribution = {
    visitorId: 'visitor_2', sessionId: 'session_9', landingPage: '/contact-us/', deviceCategory: 'mobile',
    utmSource: '', utmMedium: '', utmCampaign: '', utmContent: '', referrerHost: '',
    firstTouchAt: Date.parse('2026-08-24T15:00:00Z'),
    firstTouchLandingPage: '/',
    firstTouchUtmSource: 'google', firstTouchUtmMedium: 'organic_local',
    firstTouchUtmCampaign: 'sb_organic_202608', firstTouchUtmContent: 'gbp-website-button'
  };
  const response = await handleContactRequest(new Request('https://stonebellisimollc.com/api/contact', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firstName: 'Bea', lastName: 'Stone', email: 'bea@example.com', phone: '2015550102', attribution })
  }), env, { store, sanitizeAttribution: value => value });
  assert.equal(response.status, 200);
  assert.equal(created.sourcePlatform, 'gbp');
  assert.equal(created.sourceContentId, 'gbp-website-button');
  assert.equal(created.attributionCredit.managed, true);
  assert.equal(created.attributionCredit.basis, 'first_touch');
  assert.equal(created.attributionCredit.confidence, 'tagged');
  assert.equal(created.firstTouch.campaign, 'sb_organic_202608');
  assert.equal(created.firstTouch.at, '2026-08-24T15:00:00.000Z');
  // The submit-time visit is recorded truthfully as direct; it just does not win.
  assert.equal(created.lastTouch.platform, 'direct');
});

test('completion review worker sends one identical public Google invitation and schedules one reminder', async () => {
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  const token = await createReviewToken('lead_completed', expires, 'reviewnonce', env);
  const lead = {
    id: 'lead_completed', customerName: 'Ada Stone', email: 'ada@example.com', businessStatus: 'completed',
    reviewRequestDueAt: new Date(Date.now() - 1_000).toISOString(),
  };
  const sent = [];
  const store = {
    getDueReviewRequests: async () => [lead], getDueReviewReminders: async () => [],
    claimReviewRequest: async () => true, getLeadById: async () => lead,
    saveEmailEvent: async event => sent.push(event),
    recordReviewRequestToken: async (id, hash, tokenExpiresAt, nonce) => Object.assign(lead, { reviewRequestTokenHash: hash, reviewRequestTokenExpiresAt: tokenExpiresAt, reviewRequestTokenNonce: nonce }),
    markReviewRequestSent: async (id, kind, at) => { lead.reviewRequestSentAt = at; },
    markReviewRequestSendFailed: async () => { throw new Error('unexpected failure'); }
  };
  const result = await processDueFeedbackEmails(env, { store });
  assert.deepEqual(result, { checked: 1, sent: 1, skipped: 0, failed: 0 });
  assert.equal(sent[0].eventType, 'google_review_request');
  assert.equal(JSON.parse(sent[0].payloadJson).metadata.email_type, 'google_review_request');
  const email = renderGoogleReviewRequestEmail({ lead, reviewUrl: `https://stonebellisimollc.com/api/review/redirect?token=${encodeURIComponent(token)}` });
  assert.match(email.html, /\/api\/review\/redirect\?token=/);
  assert.match(email.text, /honest Google review/);
  assert.doesNotMatch(email.text, /rating|incentive/i);
});

test('replayed/concurrent and early claims do not send', async () => {
  const calls = [];
  const store = {
    getDueReviewRequests: async () => [{ id: 'early' }],
    getDueReviewReminders: async () => [{ id: 'clicked' }, { id: 'replied' }],
    claimReviewRequest: async (id) => { calls.push(id); return false; }
  };
  const result = await processDueFeedbackEmails(env, { store });
  assert.equal(result.checked, 3);
  assert.deepEqual(calls, ['early', 'clicked', 'replied']);
  // Eligibility is enforced transactionally in claimReviewRequest so a stale
  // scheduler read cannot send after a click/reply race.
  assert.equal(result.sent, 0);
});

test('fresh review token works after original feedback token expiry and click never claims a posted review', async () => {
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  const token = await createReviewToken('lead_redirect', expires, 'new-review-token', env);
  const lead = { id: 'lead_redirect', businessStatus: 'completed', reviewRequestSentAt: new Date().toISOString(), replyTokenExpiresAt: '2000-01-01T00:00:00.000Z', replyTokenHash: 'expired-legacy-token', reviewRequestTokenHash: await sha256Hex(token) };
  let clicked = 0;
  const response = await handleGoogleReviewRedirectRequest(new Request(`https://stonebellisimollc.com/api/review/redirect?token=${encodeURIComponent(token)}`), env, {
    store: { getLeadById: async () => lead, markReviewRequestClicked: async () => { clicked += 1; } }
  });
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), /^https:\/\/search\.google\.com\//);
  assert.equal(clicked, 1);
});

test('a review-link click after a reply does not downgrade the terminal replied status', async () => {
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  const token = await createReviewToken('lead_replied_redirect', expires, 'reply-wins', env);
  const lead = {
    id: 'lead_replied_redirect', businessStatus: 'completed', reviewRequestSentAt: new Date().toISOString(),
    reviewRequestRepliedAt: new Date().toISOString(), reviewRequestTokenHash: await sha256Hex(token)
  };
  let clicked = 0;
  const response = await handleGoogleReviewRedirectRequest(new Request(`https://stonebellisimollc.com/api/review/redirect?token=${encodeURIComponent(token)}`), env, {
    store: { getLeadById: async () => lead, markReviewRequestClicked: async () => { clicked += 1; } }
  });
  assert.equal(response.status, 302);
  assert.equal(clicked, 0);
  assert.equal(lead.reviewRequestRepliedAt !== null, true);
});

test('only one eligible reminder is claimed and sent after no click or reply', async () => {
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  const nonce = 'reminder-token';
  const token = await createReviewToken('lead_reminder', expires, nonce, env);
  const lead = { id: 'lead_reminder', customerName: 'Ada', email: 'ada@example.com', businessStatus: 'completed', reviewRequestSentAt: new Date().toISOString(), reviewRequestTokenHash: await sha256Hex(token), reviewRequestTokenExpiresAt: expires, reviewRequestTokenNonce: nonce };
  let sends = 0;
  const store = {
    getDueReviewRequests: async () => [], getDueReviewReminders: async () => [lead],
    claimReviewRequest: async () => sends === 0,
    getLeadById: async () => lead, saveEmailEvent: async () => {},
    markReviewRequestSent: async () => { sends += 1; }, markReviewRequestSendFailed: async () => { throw new Error('unexpected'); }
  };
  const first = await processDueFeedbackEmails(env, { store });
  const second = await processDueFeedbackEmails(env, { store });
  assert.equal(first.sent, 1);
  assert.equal(second.sent, 0);
  assert.equal(sends, 1);
});

test('a reply or click observed after a stale scheduler read suppresses the reminder', async () => {
  for (const field of ['reviewRequestClickedAt', 'reviewRequestRepliedAt']) {
    const lead = { id: `lead_${field}`, businessStatus: 'completed', reviewRequestSentAt: new Date().toISOString(), [field]: new Date().toISOString() };
    let emailEvents = 0;
    const result = await processDueFeedbackEmails(env, {
      store: {
        getDueReviewRequests: async () => [], getDueReviewReminders: async () => [lead],
        // Simulates a stale pre-transaction result; production's transaction
        // rejects this claim, and the worker also rechecks before delivery.
        claimReviewRequest: async () => true, getLeadById: async () => lead,
        saveEmailEvent: async () => { emailEvents += 1; }, markReviewRequestSendFailed: async () => {}
      }
    });
    assert.equal(result.sent, 0);
    assert.equal(emailEvents, 0);
  }
});

test('a claim made stale by fresh-read suppression is released immediately', async () => {
  const lead = {
    id: 'lead_release_claim', businessStatus: 'completed', reviewRequestDueAt: new Date(Date.now() - 1_000).toISOString(),
    optedOutAt: new Date().toISOString()
  };
  const releases = [];
  const result = await processDueFeedbackEmails(env, {
    store: {
      getDueReviewRequests: async () => [{ id: lead.id }], getDueReviewReminders: async () => [],
      claimReviewRequest: async () => true, getLeadById: async () => lead,
      releaseReviewRequestClaim: async (...args) => { releases.push(args); },
      saveEmailEvent: async () => assert.fail('must not send')
    }
  });
  assert.equal(result.skipped, 1);
  assert.deepEqual(releases.length, 1);
  assert.equal(releases[0][0], lead.id);
  assert.equal(releases[0][1], 'request');
  assert.equal(releases[0][3], 'fresh_read_suppressed');
});

test('claim release never moves canonical timestamps backward after an opt-out', async () => {
  const claimedAt = '2026-08-27T10:00:00.000Z';
  const optOutAt = '2026-08-27T10:01:00.000Z';
  const db = transactionDb({
    leads: { lead_monotonic: { reviewRequestClaimedAt: claimedAt, optedOutAt: optOutAt, updatedAt: optOutAt } },
    review_requests: { lead_monotonic_request: { claimedAt, updatedAt: optOutAt } }
  });
  const result = await createFirestoreStore(db).releaseReviewRequestClaim('lead_monotonic', 'request', claimedAt, 'fresh_read_suppressed', '2026-08-27T10:00:30.000Z');
  assert.equal(result, true);
  assert.equal(db.value('leads', 'lead_monotonic').updatedAt, optOutAt);
  assert.equal(db.value('leads', 'lead_monotonic').reviewRequestClaimedAt, null);
  assert.equal(db.value('review_requests', 'lead_monotonic_request').updatedAt, optOutAt);
  assert.equal(db.value('review_requests', 'lead_monotonic_request').suppressedAt, optOutAt);
});

test('DND or an opt-out observed after a stale scheduler read suppresses review outreach', async () => {
  for (const suppression of [{ dnd: true }, { optedOutAt: new Date().toISOString() }]) {
  const lead = {
    id: 'lead_opted_out',
    businessStatus: 'completed',
    ...suppression,
    reviewRequestDueAt: new Date(Date.now() - 1_000).toISOString()
  };
  let emailEvents = 0;
  const result = await processDueFeedbackEmails(env, {
    store: {
      getDueReviewRequests: async () => [lead], getDueReviewReminders: async () => [],
      claimReviewRequest: async () => true, getLeadById: async () => lead,
      saveEmailEvent: async () => { emailEvents += 1; }, markReviewRequestSendFailed: async () => {}
    }
  });
  assert.equal(result.sent, 0);
  assert.equal(result.skipped, 1);
  assert.equal(emailEvents, 0);
  }
});

test('L1 pauses review outreach before the due queue is read', async () => {
  let reads = 0;
  const result = await processDueFeedbackEmails(env, {
    outboundPaused: true,
    store: { getDueReviewRequests: async () => { reads += 1; return []; } }
  });
  assert.deepEqual(result, { checked: 0, sent: 0, skipped: 0, failed: 0, paused: true });
  assert.equal(reads, 0);
});

test('an uncertain Postmark write is quarantined and never marked retryable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('socket closed after request write'); };
  let uncertain = null;
  let retryableFailures = 0;
  const lead = {
    id: 'lead_uncertain', customerName: 'Ada', email: 'ada@example.com', businessStatus: 'completed',
    reviewRequestDueAt: new Date(Date.now() - 1_000).toISOString()
  };
  try {
    const result = await processDueFeedbackEmails({ ...env, POSTMARK_MOCK_MODE: 'false', POSTMARK_SERVER_TOKEN: 'test-token' }, {
      store: {
        getDueReviewRequests: async () => [lead], getDueReviewReminders: async () => [],
        claimReviewRequest: async () => true, getLeadById: async () => lead,
        saveEmailEvent: async () => {}, recordReviewRequestToken: async () => {},
        markReviewRequestUncertain: async (id, kind) => { uncertain = { id, kind }; },
        markReviewRequestSendFailed: async () => { retryableFailures += 1; }
      }
    });
    assert.equal(result.failed, 1);
    assert.equal(result.uncertain, 1);
    assert.deepEqual(uncertain, { id: 'lead_uncertain', kind: 'request' });
    assert.equal(retryableFailures, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an accepted review email is not retried when only the audit event write fails', async () => {
  const lead = {
    id: 'lead_audit_failure', customerName: 'Ada', email: 'ada@example.com', businessStatus: 'completed',
    reviewRequestDueAt: new Date(Date.now() - 1_000).toISOString()
  };
  let markedSent = 0;
  const result = await processDueFeedbackEmails(env, {
    store: {
      getDueReviewRequests: async () => [lead], getDueReviewReminders: async () => [],
      claimReviewRequest: async () => true, getLeadById: async () => lead,
      saveEmailEvent: async () => { throw new Error('audit store unavailable'); },
      recordReviewRequestToken: async () => {},
      markReviewRequestSent: async () => { markedSent += 1; },
      markReviewRequestSendFailed: async () => { throw new Error('accepted email must not be retryable'); }
    }
  });
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(markedSent, 1);
});

test('an accepted review email is quarantined when its sent ledger write fails', async () => {
  const lead = {
    id: 'lead_sent_ledger_failure', customerName: 'Ada', email: 'ada@example.com', businessStatus: 'completed',
    reviewRequestDueAt: new Date(Date.now() - 1_000).toISOString()
  };
  let uncertain = 0;
  const result = await processDueFeedbackEmails(env, {
    store: {
      getDueReviewRequests: async () => [lead], getDueReviewReminders: async () => [],
      claimReviewRequest: async () => true, getLeadById: async () => lead,
      saveEmailEvent: async () => {}, recordReviewRequestToken: async () => {},
      markReviewRequestSent: async () => { throw new Error('Firestore unavailable after send'); },
      markReviewRequestUncertain: async () => { uncertain += 1; },
      markReviewRequestSendFailed: async () => { throw new Error('an accepted email must not be retryable'); }
    }
  });
  assert.equal(result.failed, 1);
  assert.equal(result.uncertain, 1);
  assert.equal(uncertain, 1);
});
