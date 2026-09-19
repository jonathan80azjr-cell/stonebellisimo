import assert from 'node:assert/strict';
import { initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { initializeApp as initializeClientApp } from 'firebase/app';
import { connectFirestoreEmulator, doc, getDoc, getFirestore as getClientFirestore, terminate } from 'firebase/firestore';
import {
  aggregateAnalyticsEvent,
  createLeadWithServerConversion,
  handleAdminAnalytics,
  handleAnalyticsEvents,
  recordServerConversion
} from '../src/analytics.mjs';
import { createFirestoreStore } from '../src/firebase-store.mjs';
import { createGrowthStore, normalizeSocialInquiry } from '../src/growth-store.mjs';
import { handleAdminSearchConsole, syncSearchConsole } from '../src/search-console.mjs';
import { createFeedbackToken, processDueFeedbackEmails, sha256Hex } from '../src/lead-automation.mjs';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run this test through the Firebase Emulator Suite.');
const projectId = process.env.GCLOUD_PROJECT || 'demo-stonebellisimo';
initializeAdminApp({ projectId });
const db = getAdminFirestore();
db.settings({ ignoreUndefinedProperties: true });
const store = createFirestoreStore(db);
const growthStore = createGrowthStore(db);
const today = new Date().toISOString().slice(0, 10);

function event(id, eventName, detail = {}) {
  return {
    id, eventName, occurredAt: Date.now(), pagePath: '/', pageTitle: 'Stone Bellisimo',
    visitorId: 'visitor_test', sessionId: 'session_test', landingPage: '/', deviceCategory: 'desktop',
    ...detail
  };
}

const events = [
  event('view_1', 'page_view'),
  event('gallery_1', 'gallery_view', { placement: 'homepage-gallery' }),
  event('impression_1', 'cta_impression', { ctaId: 'phone-office', ctaType: 'phone', ctaLabel: 'Call office', targetLabel: '+12015531919', placement: 'homepage-contact' }),
  event('impression_2', 'cta_impression', { ctaId: 'phone-office', ctaType: 'phone', ctaLabel: 'Call office', targetLabel: '+12015531919', placement: 'homepage-contact' }),
  event('phone_1', 'cta_click', { ctaId: 'phone-office', ctaType: 'phone', ctaLabel: 'Call office', targetLabel: '+12015531919', placement: 'homepage-contact' }),
  event('map_1', 'cta_click', { ctaId: 'map-showroom', ctaType: 'map', ctaLabel: 'Directions', targetLabel: 'Stone Bellisimo showroom', placement: 'contact-map' })
];

let response = await handleAnalyticsEvents(new Request('http://localhost/api/analytics/events', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events })
}), db);
assert.equal(response.status, 202);
assert.equal((await response.json()).accepted, events.length);

response = await handleAnalyticsEvents(new Request('http://localhost/api/analytics/events', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events })
}), db);
assert.equal((await response.json()).duplicates, events.length, 'duplicate event IDs must not be counted twice');

for (const item of events) assert.equal(await aggregateAnalyticsEvent(db, item.id), true);
for (const item of events) assert.equal(await aggregateAnalyticsEvent(db, item.id), false, 'summary aggregation must be idempotent');

await recordServerConversion(db, event('conversion_lead_1', 'form_submit', { ctaId: 'estimate-hero', ctaType: 'estimate', result: 'success' }));
await aggregateAnalyticsEvent(db, 'conversion_lead_1');

const daily = (await db.collection('analytics_daily').doc(today).get()).data();
assert.equal(daily.sessions, 1);
assert.equal(daily.pageViews, 1);
assert.equal(daily.ctaImpressions, 2);
assert.equal(daily.ctaClicks, 2);
assert.equal(daily.formSubmissions, 1);
assert.equal(daily.highIntentActions, 3);
assert.equal(daily.gallerySessions, 1);
assert.equal(daily.galleryToIntentSessions, 1);

const ctaSnapshot = await db.collection('analytics_cta_daily').where('ctaId', '==', 'phone-office').get();
assert.equal(ctaSnapshot.size, 1);
assert.equal(ctaSnapshot.docs[0].data().impressions, 2);
assert.equal(ctaSnapshot.docs[0].data().uniqueImpressions, 1, 'repeat impressions in one session are unique only once');
assert.equal(ctaSnapshot.docs[0].data().uniqueClicks, 1);

const analyticsResponse = await handleAdminAnalytics(new Request(`http://localhost/api/admin/analytics?start=${today}&end=${today}`), db);
const analytics = await analyticsResponse.json();
assert.equal(analytics.totals.ctr, 1);
assert.equal(analytics.totals.galleryToIntentRate, 1);
assert.equal(analytics.ctas.find(row => row.ctaId === 'phone-office').uniqueCtr, 1);

// Desktop visitors dial from a handset, so a long look at a number is the only
// trace of the call. Two numbers held in one visit is still one likely call.
const dwellEvents = [
  event('dwell_1', 'phone_dwell', { ctaId: 'phone-office', ctaType: 'phone', ctaLabel: 'Call office', targetLabel: '+12015531919', placement: 'homepage-contact', dwellMs: 14000, exitReason: 'blur' }),
  event('dwell_2', 'phone_dwell', { ctaId: 'phone-bella', ctaType: 'phone', ctaLabel: 'Call Bella', targetLabel: '+15512928353', placement: 'homepage-contact', dwellMs: 6000, exitReason: 'idle' })
];
response = await handleAnalyticsEvents(new Request('http://localhost/api/analytics/events', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: dwellEvents })
}), db);
assert.equal(response.status, 202);
for (const item of dwellEvents) assert.equal(await aggregateAnalyticsEvent(db, item.id), true);

const dailyWithDwell = (await db.collection('analytics_daily').doc(today).get()).data();
assert.equal(dailyWithDwell.phoneDwellSignals, 2);
assert.equal(dailyWithDwell.phoneDwellSessions, 1, 'two numbers held in one session are one likely call');
assert.equal(dailyWithDwell.phoneDwellMs, 20000);
assert.equal(dailyWithDwell.highIntentActions, 3, 'inferred dwell must not inflate the recorded high-intent count');

const dwellCta = (await db.collection('analytics_cta_daily').where('ctaId', '==', 'phone-office').get())
  .docs.map(document => document.data()).find(row => row.trafficClass === 'production');
assert.equal(dwellCta.dwellSignals, 1, 'dwell lands on the same CTA row as that number’s clicks');
assert.equal(dwellCta.clicks, 1, 'dwell must not disturb the click counters on that row');
assert.equal(dwellCta.dwell_blur, 1);

const dwellReport = await (await handleAdminAnalytics(new Request(`http://localhost/api/admin/analytics?start=${today}&end=${today}`), db)).json();
assert.equal(dwellReport.totals.phoneDwellSessions, 1);
assert.equal(dwellReport.totals.averagePhoneDwellMs, 10000);
assert.equal(dwellReport.ctas.find(row => row.ctaId === 'phone-bella').averageDwellMs, 6000);

// Test traffic must aggregate separately and stay out of default reporting.
const qaEvents = [
  event('qa_view_1', 'page_view', {
    visitorId: 'visitor_qa', sessionId: 'session_qa', utmSource: 'qa', utmMedium: 'test',
    utmCampaign: 'roi_validation'
  }),
  event('qa_phone_1', 'cta_click', {
    visitorId: 'visitor_qa', sessionId: 'session_qa', utmSource: 'qa', utmMedium: 'test',
    ctaId: 'phone-office', ctaType: 'phone', ctaLabel: 'Call office', placement: 'homepage-contact'
  })
];
response = await handleAnalyticsEvents(new Request('http://localhost/api/analytics/events', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: qaEvents })
}), db);
assert.equal(response.status, 202);
for (const item of qaEvents) assert.equal(await aggregateAnalyticsEvent(db, item.id), true);

const productionDailyAfterQa = (await db.collection('analytics_daily').doc(today).get()).data();
assert.equal(productionDailyAfterQa.pageViews, 1, 'QA page views must not reach the production daily total');
assert.equal(productionDailyAfterQa.sessions, 1, 'QA sessions must not reach the production daily total');

const qaDaily = (await db.collection('analytics_daily').doc(`${today}__test`).get()).data();
assert.equal(qaDaily.trafficClass, 'test');
assert.equal(qaDaily.pageViews, 1);
assert.equal(qaDaily.sessions, 1);
assert.equal(qaDaily.highIntentActions, 1);

const qaCtaSnapshot = await db.collection('analytics_cta_daily').where('trafficClass', '==', 'test').get();
assert.equal(qaCtaSnapshot.size, 1, 'QA CTA facts are stored apart from business CTA facts');
assert.ok(qaCtaSnapshot.docs[0].id.endsWith('__test'), 'test CTA facts use a distinct document ID');
assert.equal((await db.collection('analytics_cta_daily').where('ctaId', '==', 'phone-office').get()).size, 2);

const defaultResponse = await handleAdminAnalytics(new Request(`http://localhost/api/admin/analytics?start=${today}&end=${today}`), db);
const defaultAnalytics = await defaultResponse.json();
assert.equal(defaultAnalytics.trafficClass, 'production');
assert.equal(defaultAnalytics.totals.pageViews, 1, 'the dashboard excludes test traffic by default');
assert.equal(defaultAnalytics.testTraffic.excluded, true);
assert.equal(defaultAnalytics.testTraffic.sessions, 1, 'excluded test volume stays visible to the administrator');
assert.equal(defaultAnalytics.ctas.find(row => row.ctaId === 'phone-office').clicks, 1, 'QA clicks stay out of business CTA reporting');

const includeResponse = await handleAdminAnalytics(new Request(`http://localhost/api/admin/analytics?start=${today}&end=${today}&trafficClass=all`), db);
const includeAnalytics = await includeResponse.json();
assert.equal(includeAnalytics.trafficClass, 'all');
assert.equal(includeAnalytics.totals.pageViews, 2, 'the explicit toggle includes test traffic');
assert.equal(includeAnalytics.testTraffic.excluded, false);
assert.equal(includeAnalytics.daily.length, 1, 'both traffic classes merge into one row per date');
assert.equal(includeAnalytics.ctas.find(row => row.ctaId === 'phone-office').clicks, 2);

const outOfOrderBase = Date.now() - 5000;
const outOfOrderEvents = [
  event('phone_out_of_order', 'cta_click', {
    occurredAt: outOfOrderBase + 1000, visitorId: 'visitor_out_of_order', sessionId: 'session_out_of_order',
    ctaId: 'phone-office-out-of-order', ctaType: 'phone', ctaLabel: 'Call office', placement: 'homepage-contact'
  }),
  event('gallery_out_of_order', 'gallery_view', {
    occurredAt: outOfOrderBase, visitorId: 'visitor_out_of_order', sessionId: 'session_out_of_order',
    placement: 'homepage-gallery'
  })
];
response = await handleAnalyticsEvents(new Request('http://localhost/api/analytics/events', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: outOfOrderEvents })
}), db);
assert.equal(response.status, 202);
await aggregateAnalyticsEvent(db, 'phone_out_of_order');
await aggregateAnalyticsEvent(db, 'gallery_out_of_order');
const outOfOrderDaily = (await db.collection('analytics_daily').doc(today).get()).data();
assert.equal(outOfOrderDaily.gallerySessions, 2);
assert.equal(outOfOrderDaily.galleryToIntentSessions, 2, 'trigger ordering must not change gallery-to-intent attribution');

const atomicLead = {
  id: 'lead_atomic_conversion', customerName: 'Atomic Conversion', firstName: 'Atomic', lastName: 'Conversion',
  email: 'atomic@example.com', phone: '2015550188', submittedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
};
await createLeadWithServerConversion(db, atomicLead, event('conversion_lead_atomic_conversion', 'form_submit', {
  visitorId: 'visitor_atomic', sessionId: 'session_atomic', ctaId: 'estimate-hero', ctaType: 'estimate'
}));
const [atomicLeadSnapshot, atomicEventSnapshot] = await db.getAll(
  db.collection('leads').doc(atomicLead.id),
  db.collection('analytics_events').doc('conversion_lead_atomic_conversion')
);
assert.equal(atomicLeadSnapshot.exists, true);
assert.equal(atomicEventSnapshot.exists, true, 'lead and server conversion must commit atomically');
const duplicateIdentityLead = { ...atomicLead, id: 'lead_atomic_duplicate', submittedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
const deduped = await createLeadWithServerConversion(db, duplicateIdentityLead, event('conversion_lead_atomic_duplicate', 'form_submit', {
  visitorId: 'visitor_atomic_2', sessionId: 'session_atomic_2', ctaId: 'estimate-footer', ctaType: 'estimate'
}));
assert.deepEqual(deduped, { created: false, leadId: atomicLead.id }, 'same normalized phone/email must reuse one canonical lead');
assert.equal((await db.collection('leads').doc(duplicateIdentityLead.id).get()).exists, false);
await db.collection('leads').doc(atomicLead.id).delete();
await db.collection('analytics_events').doc('conversion_lead_atomic_conversion').delete();
await db.collection('analytics_events').doc('conversion_lead_atomic_duplicate').delete();
for (const identity of (await db.collection('lead_identities').where('leadId', '==', atomicLead.id).get()).docs) await identity.ref.delete();

const householdOne = { ...atomicLead, id: 'lead_household_stone', firstName: 'Ada', lastName: 'Stone', email: 'ada.stone@example.com', phone: '2015550177' };
const householdTwo = { ...atomicLead, id: 'lead_household_rivera', firstName: 'Ben', lastName: 'Rivera', email: 'ben.rivera@example.com', phone: '2015550177' };
const householdOneResult = await createLeadWithServerConversion(db, householdOne, event('conversion_household_stone', 'form_submit', { visitorId: 'visitor_household_1', sessionId: 'session_household_1', ctaId: 'estimate-hero', ctaType: 'estimate' }));
const householdTwoResult = await createLeadWithServerConversion(db, householdTwo, event('conversion_household_rivera', 'form_submit', { visitorId: 'visitor_household_2', sessionId: 'session_household_2', ctaId: 'estimate-footer', ctaType: 'estimate' }));
assert.deepEqual(householdOneResult, { created: true, leadId: householdOne.id });
assert.deepEqual(householdTwoResult, { created: true, leadId: householdTwo.id }, 'shared household phone with different surname must not merge contacts');
for (const leadId of [householdOne.id, householdTwo.id]) {
  await db.collection('leads').doc(leadId).delete();
  for (const identity of (await db.collection('lead_identities').where('leadId', '==', leadId).get()).docs) await identity.ref.delete();
}
await db.collection('analytics_events').doc('conversion_household_stone').delete();
await db.collection('analytics_events').doc('conversion_household_rivera').delete();

const leadEnv = {
  ENVIRONMENT: 'test', PUBLIC_SITE_URL: 'http://localhost:5000', POSTMARK_MOCK_MODE: 'true',
  FEEDBACK_TOKEN_SECRET: 'integration-feedback-token-secret', FEEDBACK_BATCH_LIMIT: '10', FEEDBACK_MAX_ATTEMPTS: '3',
  POSTMARK_FROM_EMAIL: 'admin@stonebellisimollc.com', BUSINESS_REPLY_TO_EMAIL: 'admin@stonebellisimollc.com'
};
const dueAt = new Date(Date.now() - 86400000).toISOString();
for (let index = 1; index <= 3; index += 1) {
  const id = `lead_${index}`;
  const expires = new Date(Date.now() + 30 * 86400000).toISOString();
  const token = await createFeedbackToken(id, expires, leadEnv);
  await store.createLead({
    id, customerName: `Customer ${index}`, firstName: 'Customer', lastName: String(index),
    email: `customer${index}@example.com`, phone: '2015550100', projectType: index === 2 ? 'Kitchen' : 'Vanity',
    material: 'Quartz', source: 'Website', message: '', submittedAt: new Date(Date.now() - index * 60000).toISOString(),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ipHash: 'same_hash',
    feedbackEmailDueAt: dueAt, feedbackStatus: 'pending', feedbackEmailAttemptCount: 0,
    replyTokenExpiresAt: expires, replyTokenHash: await sha256Hex(token)
  });
}
assert.equal(await store.countRecentByIpHash('same_hash', new Date(Date.now() - 3600000).toISOString()), 3);
const pageOne = await store.listLeads({ limit: 2 });
assert.equal(pageOne.leads.length, 2);
assert.ok(pageOne.nextCursor);
const pageTwo = await store.listLeads({ limit: 2, cursor: pageOne.nextCursor });
assert.equal(pageTwo.leads.length, 1);
assert.equal((await store.listLeads({ search: 'Kitchen' })).leads[0].id, 'lead_2');

const businessUpdatedAt = new Date().toISOString();
const updatedBusinessLead = await store.updateLeadBusiness('lead_2', {
  businessStatus: 'in_progress', clientChargeCents: 250_000, biteSitesShareCents: 25_000,
  biteSitesRateBps: 1000, updatedAt: businessUpdatedAt
});
assert.equal(updatedBusinessLead.businessStatus, 'in_progress');
assert.equal(updatedBusinessLead.clientChargeCents, 250_000);
assert.equal(updatedBusinessLead.biteSitesShareCents, 25_000);
assert.equal((await store.listLeads({ status: 'in_progress' })).leads[0].id, 'lead_2');

for (let index = 1; index <= 3; index += 1) {
  await db.collection('leads').doc(`lead_${index}`).update({
    businessStatus: 'completed', salesStatus: 'Job Completed', reviewRequestDueAt: dueAt,
    reviewRequestStatus: 'pending', reviewRequestAttemptCount: 0
  });
}
const reviewClaimedAt = new Date().toISOString();
const claims = await Promise.all([
  store.claimReviewRequest('lead_1', 'request', reviewClaimedAt, new Date(Date.now() - 900000).toISOString()),
  store.claimReviewRequest('lead_1', 'request', reviewClaimedAt, new Date(Date.now() - 900000).toISOString())
]);
assert.equal(claims.filter(Boolean).length, 1, 'only one scheduled worker may claim a review request');
await db.collection('leads').doc('lead_1').update({ reviewRequestClaimedAt: null, reviewRequestStatus: 'pending' });
await db.collection('review_requests').doc('lead_1_request').set({ claimedAt: null, state: 'pending' }, { merge: true });
const feedbackSummary = await processDueFeedbackEmails(leadEnv, { store });
assert.equal(feedbackSummary.sent, 3, 'completion-based review processing claims and records each due message once');

const inquiry = normalizeSocialInquiry({
  platform: 'instagram', accountId: 'ig-account', remoteInquiryId: 'dm-emulator', remoteContactId: 'contact-emulator',
  category: 'estimate_intent', projectType: 'Kitchen', material: 'Quartz', city: 'Hoboken', usableContactMethod: 'platform_dm'
});
const firstInquiry = await growthStore.recordInquiryEvent('hl_inquiry_emulator', inquiry);
const replayedInquiry = await growthStore.recordInquiryEvent('hl_inquiry_emulator', inquiry);
assert.equal(firstInquiry.duplicate, false);
assert.equal(replayedInquiry.duplicate, true, 'replayed social webhooks must not duplicate inquiries');
const inquiryId = 'instagram:dm-emulator';
const firstOptOutAt = new Date(Date.now() - 5000).toISOString();
await growthStore.recordConsentEvent('hl_optout_1', { inquiryDocumentId: inquiryId, consentStatus: 'revoked', consentVersion: 'consent-v1', occurredAt: firstOptOutAt });
await growthStore.recordConsentEvent('hl_optout_2', { inquiryDocumentId: inquiryId, consentStatus: 'declined', consentVersion: 'consent-v1', occurredAt: new Date().toISOString() });
assert.equal((await growthStore.getInquiry(inquiryId)).optedOutAt, firstOptOutAt, 'repeat opt-outs retain the original timestamp');
await assert.rejects(
  growthStore.recordConsentEvent('hl_bad_restore', { inquiryDocumentId: inquiryId, consentStatus: 'granted', consentVersion: 'consent-v1' }),
  /named human/
);
await growthStore.recordHumanConsentEvent(inquiryId, 'consent-v2', 'Jensy');
const restored = await growthStore.getInquiry(inquiryId);
assert.equal(restored.dnd, false);
assert.equal(restored.consentRestoredBy, 'Jensy');
await growthStore.recordConsentEvent('hl_restore_cycle_optout', {
  inquiryDocumentId: inquiryId, consentStatus: 'revoked', consentVersion: 'consent-v2', occurredAt: new Date().toISOString()
});
await growthStore.recordHumanConsentEvent(inquiryId, 'consent-v2', 'Jonathan');
const restoredAgain = await growthStore.getInquiry(inquiryId);
assert.equal(restoredAgain.dnd, false, 'the same approved wording may support a later fresh human consent event');
assert.equal(restoredAgain.consentRestoredBy, 'Jonathan');
const qualified = await growthStore.recordQualificationEvent('hl_qualified_emulator', {
  inquiryDocumentId: inquiryId, serviceFit: true, serviceAreaFit: true, genuineProjectIntent: true,
  usableContactMethod: 'platform_dm', consentStatus: 'granted', consentVersion: 'consent-v2',
  claimedBy: 'Jensy', qualificationVersion: 'SB_GROWTH_V1'
});
const replayedQualification = await growthStore.recordQualificationEvent('hl_qualified_emulator', {
  inquiryDocumentId: inquiryId, serviceFit: true, serviceAreaFit: true, genuineProjectIntent: true,
  usableContactMethod: 'platform_dm', consentStatus: 'granted', consentVersion: 'consent-v2', claimedBy: 'Jensy'
});
assert.equal(qualified.duplicate, false);
assert.equal(replayedQualification.duplicate, true, 'qualification replay must create one lead and opportunity mirror');
assert.equal((await db.collection('leads').doc(qualified.lead.id).get()).data().salesStatus, 'Qualified');
const postQualificationOptOutAt = new Date().toISOString();
await growthStore.recordConsentEvent('hl_optout_after_qualification', {
  inquiryDocumentId: inquiryId, consentStatus: 'revoked', consentVersion: 'consent-v2', occurredAt: postQualificationOptOutAt
});
const optedOutLead = (await db.collection('leads').doc(qualified.lead.id).get()).data();
assert.equal(optedOutLead.dnd, true, 'a later opt-out propagates to the canonical Firebase lead');
assert.equal(optedOutLead.optedOutAt, postQualificationOptOutAt);
await db.collection('leads').doc(qualified.lead.id).update({
  businessStatus: 'completed',
  salesStatus: 'Job Completed',
  reviewRequestDueAt: dueAt,
  reviewRequestStatus: 'pending'
});
assert.equal(
  await store.claimReviewRequest(qualified.lead.id, 'request', new Date().toISOString(), new Date(Date.now() - 900000).toISOString()),
  false,
  'a cross-channel opt-out suppresses completion-based review outreach'
);
await growthStore.setControl({ level: 'L4', targetType: 'lead', targetId: 'lead_3', active: true }, 'Jonathan');
const l4Lead = (await db.collection('leads').doc('lead_3').get()).data();
assert.equal(l4Lead.dnd, true, 'L4 writes canonical lead suppression, not only a dashboard flag');
assert.ok(l4Lead.optedOutAt);
await assert.rejects(
  growthStore.setControl({ level: 'L4', targetType: 'lead', targetId: 'lead_3', active: false }, 'Jonathan'),
  /named-human consent event/
);

const firstFeedback = await store.saveFeedback({ leadId: 'lead_1', rating: 5, comment: 'Excellent', source: 'test', receivedAt: new Date().toISOString() });
const duplicateFeedback = await store.saveFeedback({ leadId: 'lead_1', rating: 4, comment: 'Duplicate', source: 'test', receivedAt: new Date().toISOString() });
assert.equal(firstFeedback.accepted, true);
assert.equal(duplicateFeedback.accepted, false);

const fakeAuth = { getClient: async () => ({ getAccessToken: async () => ({ token: 'fake-token' }) }) };
const fakeFetch = async (_url, options) => {
  const request = JSON.parse(options.body);
  const queryRows = request.dimensions.length > 1
    ? [{ keys: [today, 'StoneBellisimo countertops', 'https://stonebellisimollc.com/'], clicks: 4, impressions: 20, ctr: .2, position: 2.5 }]
    : [{ keys: [today], clicks: 10, impressions: 100, ctr: .1, position: 5 }];
  return new Response(JSON.stringify({ rows: queryRows }), { status: 200, headers: { 'content-type': 'application/json' } });
};
await syncSearchConsole({ db, startDate: today, endDate: today, auth: fakeAuth, fetchImpl: fakeFetch });
const searchResponse = await handleAdminSearchConsole(new Request(`http://localhost/api/admin/search-console?start=${today}&end=${today}`), db);
const search = await searchResponse.json();
assert.equal(search.totals.impressions, 100);
assert.equal(search.branded.impressions, 20);
assert.equal(search.topQueries[0].key, 'StoneBellisimo countertops');

const clientApp = initializeClientApp({ projectId, apiKey: 'demo-key', appId: 'demo-app' }, 'rules-test');
const clientDb = getClientFirestore(clientApp);
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
connectFirestoreEmulator(clientDb, host, Number(port));
await assert.rejects(getDoc(doc(clientDb, 'leads', 'lead_1')), /permission|denied/i, 'direct browser Firestore reads must be denied');
await terminate(clientDb);

console.info('Firebase emulator integration checks passed.');
