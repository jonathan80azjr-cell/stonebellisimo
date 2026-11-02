import test from 'node:test';
import assert from 'node:assert/strict';
import { handleContactRequest, SMS_CONSENT_VERSION, validateContact } from '../src/lead-automation.mjs';
import { nextPermittedCallTime } from '../src/twilio-automation.mjs';

const CONTACT = {
  firstName: 'Ada',
  lastName: 'Stone',
  email: 'ada@example.com',
  phone: '2015550101',
  preferredContactMethod: 'email'
};

test('phone contact requires affirmative consent and scheduled callbacks require a valid future time', () => {
  assert.equal(validateContact({ ...CONTACT, preferredContactMethod: 'call' }).error, 'Please confirm consent for an AI call or choose another follow-up method.');

  const granted = validateContact({
    ...CONTACT,
    preferredContactMethod: 'call',
    aiCallConsent: true,
    contactTimezone: 'America/New_York'
  });
  assert.equal(granted.payload.phoneE164, '+12015550101');
  assert.equal(granted.payload.aiCallConsent, true);
  assert.equal(granted.payload.phoneContactConsent, true);
  assert.equal(granted.payload.aiCallConsentTextVersion, 'ai_call_transcript_v1');

  const callbackAt = nextPermittedCallTime(new Date(Date.now() + 60 * 60 * 1000), 'America/New_York').toISOString();

  const scheduled = validateContact({
    ...CONTACT,
    preferredContactMethod: 'scheduled_call',
    aiCallConsent: true,
    preferredCallbackAt: callbackAt,
    preferredCallbackTimezone: 'America/New_York'
  });
  assert.ok(scheduled.payload.preferredCallbackAt);
  assert.equal(scheduled.payload.preferredCallbackTimezone, 'America/New_York');

  const missingTime = validateContact({ ...CONTACT, preferredContactMethod: 'scheduled_call', aiCallConsent: true });
  assert.equal(missingTime.error, 'Please choose a future callback time within the next 90 days.');

  const sms = validateContact({ ...CONTACT, preferredContactMethod: 'text', smsConsent: true });
  assert.equal(sms.payload.smsConsentTextVersion, SMS_CONSENT_VERSION);
  assert.equal(sms.payload.phoneContactConsent, true);

  const afterHoursAt = new Date(nextPermittedCallTime(new Date(Date.now() + 60 * 60 * 1000), 'America/New_York').getTime() + 12 * 60 * 60 * 1000);
  const afterHours = validateContact({
    ...CONTACT,
    preferredContactMethod: 'scheduled_call',
    aiCallConsent: true,
    preferredCallbackAt: afterHoursAt.toISOString(),
    preferredCallbackTimezone: 'America/New_York'
  });
  assert.equal(afterHours.error, 'Please choose a callback time between 9 a.m. and 8 p.m. in your local time.');
});

test('contact submissions are rate limited before persistence or outbound delivery', async () => {
  const store = {
    countRecentByIpHash: async () => 2,
    createLead: async () => { throw new Error('rate-limited leads must not be persisted'); }
  };
  const request = new Request('https://stonebellisimollc.com/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.20' },
    body: JSON.stringify({
      firstName: 'Rate', lastName: 'Limited', email: 'rate@example.com', phone: '2015550101', preferredContactMethod: 'email',
      projectType: 'Kitchen', material: 'Quartz', source: 'Unit test'
    })
  });
  const response = await handleContactRequest(request, {
    ENVIRONMENT: 'production',
    FEEDBACK_TOKEN_SECRET: 'unit-test-feedback-secret', CONTACT_RATE_LIMIT: '2'
  }, { store });
  assert.equal(response.status, 429);
});

test('form consent checkboxes show the exact archived copy for each consent version', async () => {
  const { readFile } = await import('node:fs/promises');
  const { CONSENT_COPY, AI_CALL_CONSENT_VERSION, SMS_CONSENT_VERSION } = await import('../src/lead-automation.mjs');
  for (const page of ['public/index.html', 'public/contact-us/index.html']) {
    const html = await readFile(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.ok(html.includes(CONSENT_COPY[AI_CALL_CONSENT_VERSION]), `${page} AI-call consent copy differs from ${AI_CALL_CONSENT_VERSION}`);
    assert.ok(html.includes(CONSENT_COPY[SMS_CONSENT_VERSION]), `${page} SMS consent copy differs from ${SMS_CONSENT_VERSION}`);
    assert.match(html, /href="\/privacy\/"/);
    assert.match(html, /href="\/terms\/"/);
  }
});
