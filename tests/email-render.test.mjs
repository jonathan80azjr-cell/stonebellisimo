import test from 'node:test';
import assert from 'node:assert/strict';
import { BUSINESS_INFO, renderFollowUpStatusEmail, renderCustomBrandedEmail } from '../src/email/render.mjs';

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
