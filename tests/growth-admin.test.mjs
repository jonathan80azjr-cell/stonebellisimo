import assert from 'node:assert/strict';
import test from 'node:test';
import { handleGrowthAdminRequest, isGrowthOwnerEmail } from '../src/growth-admin.mjs';

function manifestInput(overrides = {}) {
  return {
    month: '2026-08', projectId: 'project-1', material: 'Quartz', projectType: 'Kitchen', city: 'Union City',
    contentPillar: 'project_reveal', rightsApproved: true, privacyCleared: true, priorPostStatus: 'new',
    ...overrides
  };
}

test('growth approval ownership is restricted to Jensy and Jonathan', () => {
  assert.equal(isGrowthOwnerEmail(' JensyJimenez723@gmail.com '), true);
  assert.equal(isGrowthOwnerEmail('jonathan80azjr@gmail.com'), true);
  assert.equal(isGrowthOwnerEmail('stonebellisimollc@outlook.com'), false);
});

test('admin creates a server-normalized content manifest', async () => {
  let received;
  const response = await handleGrowthAdminRequest(new Request('https://example.com/api/admin/growth/content', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(manifestInput())
  }), {
    actor: 'jensy@example.com',
    growthStore: { createContentManifest: async (manifest, actor) => { received = { ...manifest, actor }; return { ...manifest, id: 'c1' }; } }
  });
  assert.equal(response.status, 201);
  assert.equal(received.status, 'discovered');
  assert.equal(received.actor, 'jensy@example.com');
  assert.equal(received.projectId, 'project-1');
});

test('admin rejects an incomplete offer manifest', async () => {
  const response = await handleGrowthAdminRequest(new Request('https://example.com/api/admin/growth/content', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(manifestInput({ includesOffer: true }))
  }), { growthStore: { createContentManifest: async () => assert.fail('must not write') } });
  assert.equal(response.status, 400);
});

test('asset upload is private, hashed, and recorded after storage succeeds', async () => {
  const saves = [];
  const form = new FormData();
  form.set('file', new File([Buffer.from('image-data')], 'kitchen.jpg', { type: 'image/jpeg' }));
  const store = {
    getContent: async () => ({ id: 'c1', status: 'discovered' }),
    addContentAsset: async (_id, asset) => ({ id: 'c1', assets: [asset] })
  };
  const bucket = { file: path => ({
    save: async (buffer, options) => saves.push({ path, buffer, options }),
    delete: async () => assert.fail('successful upload must not be deleted')
  }) };
  const response = await handleGrowthAdminRequest(new Request('https://example.com/api/admin/growth/content/c1/assets', {
    method: 'POST', body: form
  }), { growthStore: store, bucket, actor: 'jonathan@example.com' });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.match(body.asset.sha256, /^[a-f0-9]{64}$/);
  assert.match(saves[0].path, /^growth\/social-content\/c1\//);
  assert.equal(saves[0].options.metadata.cacheControl, 'private, no-store');
});

test('video intake records explicit vertical verification evidence', async () => {
  let recorded;
  const form = new FormData();
  form.set('file', new File([Buffer.from('video-data')], 'reveal.mp4', { type: 'video/mp4' }));
  form.set('verticalApproved', 'true');
  const response = await handleGrowthAdminRequest(new Request('https://example.com/api/admin/growth/content/c1/assets', {
    method: 'POST', body: form
  }), {
    growthStore: {
      getContent: async () => ({ id: 'c1', status: 'discovered' }),
      addContentAsset: async (_id, asset) => { recorded = asset; return { id: 'c1', assets: [asset] }; }
    },
    bucket: { file: () => ({ save: async () => {}, delete: async () => {} }) },
    actor: 'jensy@example.com'
  });
  assert.equal(response.status, 201);
  assert.equal(recorded.verticalApproved, true);
});

test('qualification endpoint refuses an automated or partial qualification', async () => {
  const response = await handleGrowthAdminRequest(new Request('https://example.com/api/admin/growth/inquiries/instagram:dm1/qualify', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceFit: true })
  }), { growthStore: { qualifyInquiry: async () => assert.fail('must not write') } });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /service area/i);
});
