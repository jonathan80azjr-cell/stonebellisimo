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

test('staff outcome stages preserve compatibility and allow job completion before collection', async () => {
  let saved;
  const adminStore = { updateLeadBusiness: async (_id, update) => { saved = update; return { id: 'lead_123', ...update }; } };
  const completed = await handleAdminRequest(
    updateRequest({ salesStatus: 'Job Completed', businessStatus: 'in_progress', clientCharge: '' }),
    {},
    { firebaseAuthorized: true, adminStore }
  );
  assert.equal(completed.status, 200);
  assert.equal(saved.salesStatus, 'Job Completed');
  assert.equal(saved.businessStatus, 'completed');
  assert.equal(saved.stageTimestampField, 'jobCompletedAt');

  const collected = await handleAdminRequest(
    updateRequest({ salesStatus: 'Invoice Collected', businessStatus: 'completed', clientCharge: '' }),
    {},
    { firebaseAuthorized: true, adminStore }
  );
  assert.equal(collected.status, 400);
});

test('admin can assign and clear a lead designation without changing the project stage', async () => {
  let saved;
  const adminStore = {
    async updateLeadBusiness(id, update) {
      saved = { id, ...update };
      return saved;
    }
  };

  const assigned = await handleAdminRequest(
    updateRequest({ designation: 'feedback_sent', salesStatus: 'Qualified', businessStatus: 'in_progress', clientCharge: '' }),
    {},
    { firebaseAuthorized: true, adminStore }
  );
  const assignedResult = await assigned.json();
  assert.equal(assigned.status, 200);
  assert.equal(assignedResult.lead.designation, 'feedback_sent');
  assert.equal(saved.businessStatus, 'in_progress');

  const invalid = await handleAdminRequest(
    updateRequest({ designation: 'not-a-designation', businessStatus: 'new', clientCharge: '' }),
    {},
    { firebaseAuthorized: true, adminStore }
  );
  assert.equal(invalid.status, 400);
});

test('follow-up status template previews through the existing admin email path', async () => {
  const response = await handleAdminRequest(
    new Request('https://example.com/api/admin/email/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ leadId: 'lead_123', template: 'follow_up_status' })
    }),
    {},
    {
      firebaseAuthorized: true,
      adminStore: {
        async getLeadById() {
          return { id: 'lead_123', customerName: 'Ava Stone', projectType: 'Kitchen countertops' };
        }
      }
    }
  );
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.match(result.html, /logo-mono\.png/);
  assert.match(result.html, /Ava Stone/);
  assert.match(result.text, /Already completed/);
});
