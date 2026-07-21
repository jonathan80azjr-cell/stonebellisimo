import test from 'node:test';
import assert from 'node:assert/strict';
import { handleContactRequest } from '../src/lead-automation.mjs';

test('contact submissions are rate limited before persistence or outbound delivery', async () => {
  const store = {
    countRecentByIpHash: async () => 2,
    createLead: async () => { throw new Error('rate-limited leads must not be persisted'); }
  };
  const request = new Request('https://stonebellisimollc.com/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.20' },
    body: JSON.stringify({
      firstName: 'Rate', lastName: 'Limited', email: 'rate@example.com', phone: '2015550101',
      projectType: 'Kitchen', material: 'Quartz', source: 'Unit test'
    })
  });
  const response = await handleContactRequest(request, {
    ENVIRONMENT: 'production', N8N_WEBHOOK_URL: 'https://example.com/webhook',
    FEEDBACK_TOKEN_SECRET: 'unit-test-feedback-secret', CONTACT_RATE_LIMIT: '2'
  }, { store });
  assert.equal(response.status, 429);
});
