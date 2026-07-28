import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAdminRequest } from '../src/admin-dashboard.mjs';

function updateRequest(body) {
  return new Request('https://example.com/api/admin/leads/lead_123', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

test('completed lead updates calculate and store the Bite Sites 10% share in cents', async () => {
  let saved;
  const adminStore = {
    async updateLeadBusiness(id, update) {
      saved = { id, ...update };
      return saved;
    }
  };

  const response = await handleAdminRequest(
    updateRequest({ businessStatus: 'completed', clientCharge: '$12,345.67' }),
    {},
    { firebaseAuthorized: true, adminStore }
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.success, true);
  assert.equal(saved.id, 'lead_123');
  assert.equal(saved.businessStatus, 'completed');
  assert.equal(saved.clientChargeCents, 1_234_567);
  assert.equal(saved.biteSitesShareCents, 123_457);
  assert.equal(saved.biteSitesRateBps, 1000);
});

test('completed leads require a positive client charge', async () => {
  let called = false;
  const response = await handleAdminRequest(
    updateRequest({ businessStatus: 'completed', clientCharge: '' }),
    {},
    { firebaseAuthorized: true, adminStore: { updateLeadBusiness: async () => { called = true; } } }
  );
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.success, false);
  assert.match(result.message, /amount charged/i);
  assert.equal(called, false);
});

test('lead business updates reject invalid statuses and currency precision', async () => {
  for (const body of [
    { businessStatus: 'won', clientCharge: '100.00' },
    { businessStatus: 'in_progress', clientCharge: '100.001' }
  ]) {
    const response = await handleAdminRequest(updateRequest(body), {}, { firebaseAuthorized: true, adminStore: {} });
    assert.equal(response.status, 400);
  }
});
