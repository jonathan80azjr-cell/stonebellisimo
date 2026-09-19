import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { handleHighLevelEvents } from '../src/growth-integration.mjs';

const secret = 'integration-test-secret';
const nowSeconds = () => String(Math.floor(Date.now() / 1000));
const env = {
  HIGHLEVEL_LOCATION_ID: 'location-1',
  HIGHLEVEL_INSTAGRAM_ACCOUNT_ID: 'instagram-1',
  HIGHLEVEL_FACEBOOK_ACCOUNT_ID: 'facebook-1',
  HIGHLEVEL_WEBHOOK_SECRET: secret
};

function signedRequest(payload, overrides = {}) {
  const body = JSON.stringify(payload);
  const timestamp = nowSeconds();
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return new Request('https://stonebellisimollc.com/api/integrations/highlevel/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-highlevel-timestamp': timestamp, 'x-highlevel-signature': signature },
    body,
    ...overrides
  });
}

test('rejects an invalid signature before any store access', async () => {
  const request = signedRequest({ type: 'claim' });
  request.headers.set('x-highlevel-signature', '0'.repeat(64));
  const response = await handleHighLevelEvents(request, env, { growthStore: new Proxy({}, { get: () => () => assert.fail('must not write') }) });
  assert.equal(response.status, 401);
});

test('rejects wrong-location and wrong-account events', async () => {
  for (const payload of [
    { type: 'social_inquiry', locationId: 'wrong', accountId: 'instagram-1' },
    { type: 'social_inquiry', locationId: 'location-1', accountId: 'wrong' }
  ]) {
    const response = await handleHighLevelEvents(signedRequest(payload), env, { growthStore: {} });
    assert.equal(response.status, 403);
  }
});

test('stores structured inquiry metadata without a message body and replays idempotently', async () => {
  let saved;
  const payload = {
    type: 'social_inquiry', eventId: 'event-1', locationId: 'location-1', accountId: 'instagram-1',
    platform: 'instagram', inquiryId: 'dm-1', category: 'estimate_intent', city: 'Hoboken', message: 'private customer text'
  };
  const store = { recordInquiryEvent: async (id, inquiry) => { saved = { id, inquiry }; return { duplicate: true }; } };
  const response = await handleHighLevelEvents(signedRequest(payload), env, { growthStore: store });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).duplicate, true);
  assert.equal(saved.inquiry.message, undefined);
  assert.equal(saved.inquiry.city, 'Hoboken');
});

test('qualification forwards only explicit staff evidence', async () => {
  let event;
  const payload = {
    type: 'qualification', eventId: 'event-2', locationId: 'location-1', accountId: 'facebook-1',
    platform: 'facebook', inquiryId: 'facebook:dm-2', qualified: true, serviceFit: true, serviceAreaFit: true,
    genuineProjectIntent: true, usableContactMethod: 'platform_dm', consentStatus: 'granted', consentVersion: 'consent-v1',
    claimedBy: 'Jonathan', email: 'client@example.com', message: 'must never persist'
  };
  const response = await handleHighLevelEvents(signedRequest(payload), env, {
    growthStore: { recordQualificationEvent: async (_id, value) => { event = value; return { duplicate: false }; } }
  });
  assert.equal(response.status, 200);
  assert.equal(event.serviceFit, true);
  assert.equal(event.email, 'client@example.com');
  assert.equal(event.message, undefined);
});

test('L3 rejects new inquiry intake for the disconnected platform', async () => {
  let writes = 0;
  const payload = {
    type: 'social_inquiry', eventId: 'event-l3', locationId: 'location-1', accountId: 'instagram-1',
    platform: 'instagram', inquiryId: 'dm-l3', category: 'estimate_intent'
  };
  const response = await handleHighLevelEvents(signedRequest(payload), env, {
    growthStore: {
      getControls: async () => ({ disconnectedPlatforms: ['instagram'] }),
      recordInquiryEvent: async () => { writes += 1; }
    }
  });
  assert.equal(response.status, 503);
  assert.equal(writes, 0);
});
