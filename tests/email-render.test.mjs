import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSINESS_INFO,
  renderFollowUpStatusEmail,
  renderCustomBrandedEmail,
  renderImmediateConfirmationEmail
} from '../src/email/render.mjs';

test('branded emails use a visible white logo asset in the dark header', () => {
  const email = renderCustomBrandedEmail({ lead: {}, subject: 'Hello', message: 'Checking in.' });
  assert.equal(BUSINESS_INFO.logoUrl, 'https://stonebellisimollc.com/assets/img/logo-mono.png');
  assert.match(email.html, /logo-mono\.png/);
  assert.doesNotMatch(email.html, /filter:brightness/);
});

test('follow-up status template personalizes safely when lead fields are missing', () => {
  const email = renderFollowUpStatusEmail({ lead: { customerName: '<Customer>' } });
  assert.equal(email.subject, 'A quick question about your Stone Bellisimo project');
  assert.match(email.html, /Hi &lt;Customer&gt;/);
  assert.match(email.html, /your project inquiry/);
  assert.doesNotMatch(email.html, /undefined|null/);
  assert.match(email.text, /Still interested/);
});

test('lead confirmation respects the selected contact method and marks requested times unconfirmed', () => {
  const emailOnly = renderImmediateConfirmationEmail({
    lead: { customerName: 'Dana Rivera', preferredContactMethod: 'email', phoneContactConsent: false }
  });
  assert.match(emailOnly.text, /email-only follow-up/);
  assert.doesNotMatch(emailOnly.text, /Bella may contact you|will call you/);

  const scheduledCall = renderImmediateConfirmationEmail({
    lead: {
      customerName: 'Dana Rivera',
      preferredContactMethod: 'scheduled_call',
      phoneContactConsent: true,
      preferredCallbackAt: '2026-11-02T18:00:00.000Z',
      preferredCallbackTimezone: 'America/New_York'
    }
  });
  assert.match(scheduledCall.text, /You requested a call for/);
  assert.match(scheduledCall.text, /not a confirmed appointment/);
});
