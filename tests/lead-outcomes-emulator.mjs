import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createFirestoreStore } from '../src/firebase-store.mjs';
import { handleAdminRequest } from '../src/admin-dashboard.mjs';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run through the Firebase Emulator Suite.');
initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-stonebellisimo' });
const db = getFirestore();
const store = createFirestoreStore(db);
const writer = db.bulkWriter();
for (let index = 0; index < 503; index += 1) {
  writer.set(db.collection('leads').doc(`outcome_${String(index).padStart(3, '0')}`), {
    customerName: `Client ${index}`, salesStatus: 'New Lead', businessStatus: 'new',
    submittedAt: new Date(Date.now() - index * 60000).toISOString()
  });
}
await writer.close();
const options = { firebaseAuthorized: true, adminStore: store };
async function update(id, salesStatus, clientCharge = '') {
  const response = await handleAdminRequest(new Request(`http://localhost/api/admin/leads/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ salesStatus, clientCharge, designation: null })
  }), {}, options);
  assert.equal(response.status, 200);
  return (await response.json()).lead;
}
try {
  await db.collection('leads').doc('outcome_502').update({ designation: 'email_issue' });
  await update('outcome_500', 'Estimate Scheduled');
  await update('outcome_501', 'Job Completed', '12345.67');
  await update('outcome_502', 'Invoice Collected', '2500');
  assert.deepEqual(await store.getLeadStats(), { total: 503, qualified: 3, completed: 2, biteSitesShareCents: 148457 });
  const response = await handleAdminRequest(new Request('http://localhost/api/admin/leads?limit=40'), {}, options);
  const result = await response.json();
  assert.equal(result.leads.length, 40);
  assert.ok(result.leads.every(lead => lead.salesStatus === 'New Lead'));
  assert.deepEqual(result.stats, { total: 503, qualified: 3, completed: 2, biteSitesShareCents: 148457 });
  const saved = await update('outcome_502', 'Invoice Collected', '2500');
  assert.equal(saved.designation, null);
  assert.deepEqual(await store.getLeadStats(), result.stats, 'repeat saves must not double count');
  await update('outcome_501', 'Estimate Scheduled', '12345.67');
  assert.deepEqual(await store.getLeadStats(), { total: 503, qualified: 3, completed: 1, biteSitesShareCents: 25000 });
  assert.equal((await store.listLeads({ status: 'Estimate Scheduled' })).count, 2);
  console.info('Outcome API, Firestore persistence, and totals across 503 leads passed.');
} finally {
  const cleanup = db.bulkWriter();
  for (let index = 0; index < 503; index += 1) cleanup.delete(db.collection('leads').doc(`outcome_${String(index).padStart(3, '0')}`));
  for (const id of ['outcome_501', 'outcome_502']) cleanup.delete(db.collection('review_requests').doc(`${id}_request`));
  await cleanup.close();
  await db.terminate();
}
