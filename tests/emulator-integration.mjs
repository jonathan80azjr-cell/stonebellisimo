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
import { handleAdminSearchConsole, syncSearchConsole } from '../src/search-console.mjs';
import { createFeedbackToken, processDueFeedbackEmails, sha256Hex } from '../src/lead-automation.mjs';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run this test through the Firebase Emulator Suite.');
const projectId = process.env.GCLOUD_PROJECT || 'demo-stonebellisimo';
initializeAdminApp({ projectId });
const db = getAdminFirestore();
db.settings({ ignoreUndefinedProperties: true });
const store = createFirestoreStore(db);
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
await db.collection('leads').doc(atomicLead.id).delete();
await db.collection('analytics_events').doc('conversion_lead_atomic_conversion').delete();

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

const claims = await Promise.all([
  store.claimFeedbackLead('lead_1', new Date().toISOString(), new Date(Date.now() - 900000).toISOString()),
  store.claimFeedbackLead('lead_1', new Date().toISOString(), new Date(Date.now() - 900000).toISOString())
]);
assert.equal(claims.filter(Boolean).length, 1, 'only one scheduled worker may claim a feedback lead');
await db.collection('leads').doc('lead_1').update({ feedbackEmailClaimedAt: null, feedbackStatus: 'pending' });
const feedbackSummary = await processDueFeedbackEmails(leadEnv, { store });
assert.equal(feedbackSummary.sent, 3, 'scheduled feedback processing claims and records each due message once');

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
