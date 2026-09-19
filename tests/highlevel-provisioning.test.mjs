import assert from 'node:assert/strict';
import test from 'node:test';
import { HIGHLEVEL_LOCATION_ID, HIGHLEVEL_FIREBASE_PROJECT } from '../src/highlevel-admin.mjs';
import { FOUNDATION_FIELDS, FOUNDATION_PIPELINE, FOUNDATION_TAGS, HighLevelFoundationProvisioner } from '../src/highlevel-provisioning.mjs';

function fakeApi({ collision = false, badReadback = false, failPipelineCreate = false, pipelineGet404 = false, tagVisibleAfterReads = 0, fieldGet404Attempts = 0, existingManagedClient = false } = {}) {
  const state = { pipelines: [], fields: [], tags: [], calls: [], tagReads: 0, fieldReads: 0 };
  const fetch = async (url, options) => { state.calls.push({ url, options }); const path = new URL(url).pathname; const method = options.method;
    if (method === 'GET' && path === '/opportunities/pipelines') return new Response(JSON.stringify({ pipelines: state.pipelines }));
    if (method === 'GET' && path.endsWith('/customFields')) return new Response(JSON.stringify({ customFields: state.fields }));
    if (method === 'GET' && path.endsWith('/tags')) { state.tagReads += 1; return new Response(JSON.stringify({ tags: state.tagReads >= tagVisibleAfterReads ? state.tags : [] })); }
    if (method === 'POST' && path === '/opportunities/pipelines') { if (failPipelineCreate) return new Response('{}', { status: 500 }); const value = { ...JSON.parse(options.body), id: 'pipe' }; state.pipelines.push(value); return new Response(JSON.stringify(value)); }
    if (method === 'GET' && path === '/opportunities/pipelines/pipe') return pipelineGet404 ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(badReadback ? { ...state.pipelines[0], useOpportunityProbability: true } : state.pipelines[0]));
    if (method === 'POST' && path.endsWith('/tags')) { const value = { name: JSON.parse(options.body).name, id: `tag${state.tags.length}`, locationId: HIGHLEVEL_LOCATION_ID }; state.tags.push(value); return new Response(JSON.stringify({ tag: value })); }
    if (method === 'POST' && path.endsWith('/customFields')) { const body = JSON.parse(options.body); const value = { ...body, id: `field${state.fields.length}`, fieldKey: `${body.model}.${body.name.toLowerCase().replaceAll(' ', '_')}`, picklistOptions: body.options || [], locationId: HIGHLEVEL_LOCATION_ID }; state.fields.push(value); return new Response(JSON.stringify({ customField: value })); }
    const match = path.match(/customFields\/(field\d+)$/); if (method === 'GET' && match) { state.fieldReads += 1; return state.fieldReads <= fieldGet404Attempts ? new Response('{}', { status: 404 }) : new Response(JSON.stringify({ customField: state.fields.find(item => item.id === match[1]) })); }
    return new Response('{}', { status: 500 });
  }; if (collision) state.fields.push({ ...FOUNDATION_FIELDS[0], id: 'wrong', dataType: 'DATE' }); if (existingManagedClient) state.fields.push({ ...FOUNDATION_FIELDS[0], id: 'managed-client', fieldKey: 'contact.bs_managed_client', locationId: HIGHLEVEL_LOCATION_ID }); return { state, fetch };
}

test('dry run pre-reads but never writes and does not expose its token', async () => { const { state, fetch } = fakeApi(); const client = new HighLevelFoundationProvisioner({ fetch, secretReader: () => 'secret-token' }); const result = await client.provision(); assert.equal(result.apply, false); assert.equal(state.calls.some(call => call.options.method === 'POST'), false); assert.equal(JSON.stringify(result).includes('secret-token'), false); assert.equal(JSON.stringify(client).includes('secret-token'), false); });
test('apply creates one at a time, verifies readback, writes ledgers only after success, and reruns idempotently', async () => { const { state, fetch } = fakeApi(); const ledgers = []; const client = new HighLevelFoundationProvisioner({ fetch, secretReader: () => 'secret-token', writeLedger: (path, value) => ledgers.push({ path, value }) }); const result = await client.provision({ apply: true }); assert.equal(result.pipeline, 'pipe'); assert.equal(result.tags.length, FOUNDATION_TAGS.length); assert.equal(result.fields.length, FOUNDATION_FIELDS.length); assert.equal(ledgers.length, 3); assert.ok(ledgers.some(item => item.path.endsWith('tag-ledger.json'))); assert.equal(state.calls.find(call => call.options.method === 'POST' && new URL(call.url).pathname === '/opportunities/pipelines').options.headers.Version, 'v3'); const posts = state.calls.filter(call => call.options.method === 'POST').length; await client.provision({ apply: true }); assert.equal(state.calls.filter(call => call.options.method === 'POST').length, posts); });

test('SINGLE_OPTIONS uses HighLevel options strings, never TEXTBOX_LIST payload, and reconciles the existing TEXT field', async () => {
  const { state, fetch } = fakeApi({ existingManagedClient: true });
  await new HighLevelFoundationProvisioner({ fetch, secretReader: () => 'secret', sleep: async () => {}, writeLedger: () => {} }).provision({ apply: true });
  const fieldPosts = state.calls.filter(call => call.options.method === 'POST' && new URL(call.url).pathname.endsWith('/customFields'));
  assert.equal(fieldPosts.length, FOUNDATION_FIELDS.length - 1);
  const programPost = fieldPosts.find(call => JSON.parse(call.options.body).name === 'BS Managed Program');
  assert.deepEqual(JSON.parse(programPost.options.body), { name: 'BS Managed Program', model: 'contact', dataType: 'SINGLE_OPTIONS', options: ['SB_GROWTH_V1'] });
  assert.equal('textBoxListOptions' in JSON.parse(programPost.options.body), false);
  assert.equal(fieldPosts.some(call => JSON.parse(call.options.body).name === 'BS Managed Client'), false);
});
test('wrong location, collision, and failed or uncertain create/readback hard-stop without ledger writes', async () => { assert.throws(() => new HighLevelFoundationProvisioner({ fetch: async () => new Response(), locationId: 'wrong' }), /pinned/); const collision = fakeApi({ collision: true }); const writes = []; await assert.rejects(() => new HighLevelFoundationProvisioner({ fetch: collision.fetch, secretReader: () => 'secret', writeLedger: (...x) => writes.push(x) }).provision({ apply: true }), /collision/); assert.equal(writes.length, 0); const failed = fakeApi({ failPipelineCreate: true }); await assert.rejects(() => new HighLevelFoundationProvisioner({ fetch: failed.fetch, secretReader: () => 'secret' }).provision({ apply: true }), /failed/); const uncertain = fakeApi({ badReadback: true }); await assert.rejects(() => new HighLevelFoundationProvisioner({ fetch: uncertain.fetch, secretReader: () => 'secret' }).provision({ apply: true }), /readback/); });

test('an existing pipeline with a changed stage position or dashboard setting is a collision, not an update target', async () => {
  for (const changed of [{ showInPieChart: false }, { stages: FOUNDATION_PIPELINE.stages.map((stage, index) => index === 1 ? { ...stage, position: 7 } : stage) }]) {
    const { state, fetch } = fakeApi();
    state.pipelines.push({ ...FOUNDATION_PIPELINE, id: 'pipe', ...changed });
    await assert.rejects(() => new HighLevelFoundationProvisioner({ fetch, secretReader: () => 'secret' }).provision({ apply: true }), /collision/);
  }
});

test('case-insensitive near-name pipeline, field, and tag collisions stop before any create', async () => {
  const cases = [
    state => state.pipelines.push({ ...FOUNDATION_PIPELINE, id: 'near-pipeline', name: FOUNDATION_PIPELINE.name.toLowerCase() }),
    state => state.fields.push({ ...FOUNDATION_FIELDS[0], id: 'near-field', name: FOUNDATION_FIELDS[0].name.toLowerCase(), locationId: HIGHLEVEL_LOCATION_ID }),
    state => state.tags.push({ id: 'near-tag', name: FOUNDATION_TAGS[0].toUpperCase(), locationId: HIGHLEVEL_LOCATION_ID })
  ];
  for (const addCollision of cases) {
    const { state, fetch } = fakeApi(); addCollision(state);
    await assert.rejects(() => new HighLevelFoundationProvisioner({ fetch, secretReader: () => 'secret' }).provision({ apply: true }), /collision/);
    assert.equal(state.calls.some(call => call.options.method === 'POST'), false);
  }
});

test('a 404 pipeline GET-by-ID falls back to a fresh exact-ID list read without another create', async () => {
  const { state, fetch } = fakeApi({ pipelineGet404: true });
  const client = new HighLevelFoundationProvisioner({ fetch, secretReader: () => 'secret', writeLedger: () => {} });
  const result = await client.provision({ apply: true });
  assert.equal(result.pipeline, 'pipe');
  assert.equal(state.calls.filter(call => call.options.method === 'POST' && new URL(call.url).pathname === '/opportunities/pipelines').length, 1);
  assert.ok(state.calls.filter(call => call.options.method === 'GET' && new URL(call.url).pathname === '/opportunities/pipelines').length >= 2);
});

test('tag readback polls read-only until the exact created tag appears, without a second POST', async () => {
  const { state, fetch } = fakeApi({ tagVisibleAfterReads: 3 });
  await new HighLevelFoundationProvisioner({ fetch, secretReader: () => 'secret', sleep: async () => {}, writeLedger: () => {} }).provision({ apply: true });
  assert.ok(state.tagReads >= 3); assert.equal(state.calls.filter(call => call.options.method === 'POST' && new URL(call.url).pathname.endsWith('/tags')).length, FOUNDATION_TAGS.length);
});

test('never-visible tag and eventually-consistent field both preserve one POST per object', async () => {
  const absentTag = fakeApi({ tagVisibleAfterReads: Number.POSITIVE_INFINITY });
  await assert.rejects(() => new HighLevelFoundationProvisioner({ fetch: absentTag.fetch, secretReader: () => 'secret', sleep: async () => {} }).provision({ apply: true }), /Tag readback/);
  assert.equal(absentTag.state.calls.filter(call => call.options.method === 'POST' && new URL(call.url).pathname.endsWith('/tags')).length, 1);
  const delayedField = fakeApi({ fieldGet404Attempts: 2 });
  await new HighLevelFoundationProvisioner({ fetch: delayedField.fetch, secretReader: () => 'secret', sleep: async () => {}, writeLedger: () => {} }).provision({ apply: true });
  assert.equal(delayedField.state.calls.filter(call => call.options.method === 'POST' && new URL(call.url).pathname.includes('/customFields')).length, FOUNDATION_FIELDS.length);
  const absentField = fakeApi({ fieldGet404Attempts: Number.POSITIVE_INFINITY });
  await assert.rejects(() => new HighLevelFoundationProvisioner({ fetch: absentField.fetch, secretReader: () => 'secret', sleep: async () => {} }).provision({ apply: true }), /failed \(404\)/);
  assert.equal(absentField.state.calls.filter(call => call.options.method === 'POST' && new URL(call.url).pathname.includes('/customFields')).length, 1);
});

test('eventual-consistency polling uses bounded 250ms, 500ms, then 1000ms backoff through the injected sleeper', async () => {
  const tagDelays = []; const absentTag = fakeApi({ tagVisibleAfterReads: Number.POSITIVE_INFINITY });
  await assert.rejects(() => new HighLevelFoundationProvisioner({ fetch: absentTag.fetch, secretReader: () => 'secret', sleep: async ms => { tagDelays.push(ms); } }).provision({ apply: true }), /Tag readback/);
  assert.deepEqual(tagDelays, [250, 500, 1000]);
  const fieldDelays = []; const absentField = fakeApi({ fieldGet404Attempts: Number.POSITIVE_INFINITY });
  await assert.rejects(() => new HighLevelFoundationProvisioner({ fetch: absentField.fetch, secretReader: () => 'secret', sleep: async ms => { fieldDelays.push(ms); } }).provision({ apply: true }), /failed \(404\)/);
  assert.deepEqual(fieldDelays, [250, 500, 1000]);
});
