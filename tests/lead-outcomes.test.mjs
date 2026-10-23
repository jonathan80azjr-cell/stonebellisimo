import test from 'node:test';
import assert from 'node:assert/strict';
import { projectOutcome, summarizeLeadOutcomes } from '../src/lead-outcomes.mjs';

test('booking an estimate qualifies a lead and later outcomes keep it qualified without double counting', () => {
  const lead = { salesStatus: 'New Lead', businessStatus: 'new', biteSitesShareCents: 25_000 };
  assert.deepEqual(summarizeLeadOutcomes([lead]), { total: 1, qualified: 0, completed: 0, biteSitesShareCents: 0 });
  lead.salesStatus = 'Estimate Scheduled';
  assert.deepEqual(summarizeLeadOutcomes([lead]), { total: 1, qualified: 1, completed: 0, biteSitesShareCents: 0 });
  for (const status of ['Job Completed', 'Invoice Collected']) {
    lead.salesStatus = status;
    assert.deepEqual(summarizeLeadOutcomes([lead]), { total: 1, qualified: 1, completed: 1, biteSitesShareCents: 25_000 });
  }
});

test('historical completions are retained without booking estimates for untouched leads', () => {
  for (const salesStatus of [null, '', 'New Lead', 'Qualified', 'Lost']) {
    assert.equal(projectOutcome({ salesStatus }), '');
  }
  assert.equal(projectOutcome({ businessStatus: 'completed' }), 'Job Completed');
  assert.equal(projectOutcome({ salesStatus: 'Repeat / Review' }), 'Job Completed');
  assert.equal(projectOutcome({ salesStatus: 'Repeat / Review', stageTimestamps: { invoiceCollectedAt: '2026-10-01' } }), 'Invoice Collected');
});

test('totals include projects beyond the first page and work across summary batches', () => {
  const totals = summarizeLeadOutcomes(Array.from({ length: 500 }, () => ({ salesStatus: 'New Lead' })));
  summarizeLeadOutcomes([
    { salesStatus: 'Estimate Scheduled' },
    { salesStatus: 'Job Completed', biteSitesShareCents: 123_457 },
    { salesStatus: 'Invoice Collected', biteSitesShareCents: 25_000 }
  ], totals);
  assert.deepEqual(totals, { total: 503, qualified: 3, completed: 2, biteSitesShareCents: 148_457 });
});
