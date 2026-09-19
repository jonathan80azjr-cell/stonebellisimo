import assert from 'node:assert/strict';
import test from 'node:test';
import { HIGHLEVEL_FIREBASE_PROJECT, HIGHLEVEL_LOCATION_ID, HighLevelAdminDiscovery, readHighLevelPrivateToken } from '../src/highlevel-admin.mjs';

test('reads the Firebase secret using the pinned project without logging or serializing it', () => {
  const calls = []; const token = readHighLevelPrivateToken({ execFileSync: (command, args, options) => { calls.push({ command, args, options }); return 'super-secret-token\n'; } });
  assert.equal(token, 'super-secret-token'); assert.deepEqual(calls[0].args, ['functions:secrets:access', 'HIGHLEVEL_PRIVATE_TOKEN', '--project', HIGHLEVEL_FIREBASE_PROJECT]); assert.equal(calls[0].options.stdio[1], 'pipe');
});

test('discovery pins every endpoint to the configured location and uses v3 read-only requests', async () => {
  const seen = []; const client = new HighLevelAdminDiscovery({ secretReader: () => 'super-secret-token', fetch: async (url, options) => { seen.push({ url, options }); return new Response(JSON.stringify({ ok: true })); } });
  const result = await client.discover();
  assert.equal(result.locationId, HIGHLEVEL_LOCATION_ID); assert.equal(seen.length, 7); assert.ok(seen.every(call => call.options.method === 'GET' && call.options.headers.Version === 'v3')); assert.ok(seen.every(call => !JSON.stringify(call.url).includes('super-secret-token'))); assert.equal(JSON.stringify(client).includes('super-secret-token'), false); assert.ok(seen.some(call => call.url.endsWith(`/locations/${HIGHLEVEL_LOCATION_ID}`))); assert.ok(seen.some(call => call.url.includes(`/opportunities/pipelines?locationId=${HIGHLEVEL_LOCATION_ID}`)));
});

test('rejects wrong-location construction and every attempted write', async () => {
  assert.throws(() => new HighLevelAdminDiscovery({ fetch: async () => new Response(), locationId: 'wrong' }), /pinned/);
  const client = new HighLevelAdminDiscovery({ secretReader: () => 'secret', fetch: async () => new Response('{}') });
  await assert.rejects(() => client.request({ method: 'POST', path: `/locations/${HIGHLEVEL_LOCATION_ID}` }), /read-only/);
  await assert.rejects(() => client.read('/locations/wrong'), /outside the pinned/);
});
