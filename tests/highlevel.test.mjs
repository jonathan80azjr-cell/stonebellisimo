import test from 'node:test'; import assert from 'node:assert/strict';
import { HighLevelSocialPlanner, socialPostIdempotencyKey, normalizeCaption } from '../src/highlevel.mjs';

test('local key is deterministic and caption whitespace is normalized', () => {
  const base = { sourceHash: 'asset', accountId: 'ig1', captionVersion: '2', scheduledAt: '2026-09-01T12:00:00Z' };
  assert.equal(normalizeCaption(' a \n b '), 'a b'); assert.equal(socialPostIdempotencyKey({ ...base, caption: 'a b' }), socialPostIdempotencyKey({ ...base, caption: ' a\n b ' }));
});
test('create uses the documented v3 URL, header, body, and nested response', async () => {
  let url; let options;
  const api = new HighLevelSocialPlanner({ fetch: async (target, input) => { url = target; options = input; return new Response(JSON.stringify({ results: { post: { _id: 'p1' } } }), { status: 201 }); }, accessToken: 'secret', locationId: 'loc', userId: 'user', approverId: 'approver' });
  const result = await api.createInReview({ accountId: 'ig', caption: 'x', media: [{ url: 'm' }], scheduledAt: '2026-09-01T12:00:00Z', sourceHash: 'a', captionVersion: '1' }); const body = JSON.parse(options.body);
  assert.equal(url, 'https://services.leadconnectorhq.com/social-media-posting/loc/posts'); assert.equal(options.headers.Version, 'v3'); assert.deepEqual(body.accountIds, ['ig']); assert.equal(body.summary, 'x'); assert.equal(body.scheduleDate, '2026-09-01T12:00:00.000Z'); assert.deepEqual(body.postApprovalDetails, { approver: 'approver', approvalStatus: 'pending' }); assert.equal(body.userId, 'user'); assert.equal(body.idempotencyKey, undefined); assert.equal(result.post._id, 'p1'); assert.equal(result.uncertainWrite, true);
});
test('write requires authorization and never retries a transport failure', async () => {
  const missing = new HighLevelSocialPlanner({ fetch: async () => new Response(), locationId: 'loc' });
  await assert.rejects(() => missing.createInReview({ accountId: 'ig', caption: 'x', media: [], scheduledAt: '2026-09-01T12:00:00Z', sourceHash: 'a', captionVersion: '1' }), /accessToken/);
  let calls = 0; const api = new HighLevelSocialPlanner({ fetch: async () => { calls++; throw new Error('network'); }, locationId: 'loc', accessToken: 'x', userId: 'u', approverId: 'a' });
  assert.equal((await api.createInReview({ accountId: 'ig', caption: 'x', media: [], scheduledAt: '2026-09-01T12:00:00Z', sourceHash: 'a', captionVersion: '1' })).uncertainWrite, true); assert.equal(calls, 1);
});
test('scheduling an approved post uses the v3 edit endpoint and requires readback', async () => {
  let url; let options;
  const api = new HighLevelSocialPlanner({ fetch: async (target, input) => { url = target; options = input; return new Response(JSON.stringify({ success: true }), { status: 200 }); }, accessToken: 'secret', locationId: 'loc', userId: 'user', approverId: 'approver' });
  const result = await api.scheduleApprovedPost({ postId: 'post-1', accountId: 'ig', caption: 'x', media: [{ url: 'm' }], scheduledAt: '2026-09-01T12:00:00Z' }); const body = JSON.parse(options.body);
  assert.equal(url, 'https://services.leadconnectorhq.com/social-media-posting/loc/posts/post-1'); assert.equal(options.method, 'PUT'); assert.equal(options.headers.Version, 'v3'); assert.equal(body.status, 'scheduled'); assert.deepEqual(body.accountIds, ['ig']); assert.equal(result.uncertainWrite, true);
});
test('list uses documented v3 POST filter types and parses nested results.posts', async () => {
  let url; let options; const api = new HighLevelSocialPlanner({ fetch: async (target, input) => { url = target; options = input; return new Response(JSON.stringify({ results: { posts: [{ _id: 'p' }], count: 1 } })); }, locationId: 'loc' });
  const result = await api.listPosts({ accountId: 'ig', from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z', includeUsers: true }); const body = JSON.parse(options.body);
  assert.equal(url, 'https://services.leadconnectorhq.com/social-media-posting/loc/posts/list'); assert.equal(options.method, 'POST'); assert.equal(body.accounts, 'ig'); assert.equal(body.type, 'all'); assert.equal(body.postType, 'post'); assert.equal(body.skip, '0'); assert.equal(body.limit, '100'); assert.equal(body.includeUsers, 'true'); assert.equal(result.posts[0]._id, 'p'); assert.equal(result.complete, true);
});
test('reconciliation matches account, normalized summary, and exact schedule; failed reads are never safe', async () => {
  const found = new HighLevelSocialPlanner({ fetch: async () => new Response(JSON.stringify({ results: { posts: [{ _id: 'bad', accountIds: ['ig'], summary: 'hello world', scheduleDate: 'invalid' }, { _id: 'p', accountIds: ['ig'], summary: ' hello\nworld ', scheduleDate: '2026-09-01T12:00:00.000Z' }], count: 2 } })), locationId: 'loc' });
  assert.equal((await found.reconcilePost({ accountId: 'ig', caption: 'hello world', scheduledAt: '2026-09-01T12:00:00Z' })).found, true);
  const failed = new HighLevelSocialPlanner({ fetch: async () => new Response('', { status: 503 }), locationId: 'loc', sleep: async () => {} });
  assert.equal((await failed.reconcilePost({ accountId: 'ig', caption: 'hello world', scheduledAt: '2026-09-01T12:00:00Z' })).safeToCreate, false);
});
test('reconciliation reads a second page when documented count is an exact page multiple', async () => {
  const calls = []; const api = new HighLevelSocialPlanner({ fetch: async (_url, options) => { const body = JSON.parse(options.body); calls.push(body.skip); const posts = body.skip === '0' ? [{ _id: 'other', accountIds: ['ig'], summary: 'other', scheduleDate: '2026-09-01T12:00:00.000Z' }] : [{ _id: 'wanted', accountIds: ['ig'], summary: 'caption', scheduleDate: '2026-09-01T12:00:00.000Z' }]; return new Response(JSON.stringify({ results: { posts, count: 2 } })); }, locationId: 'loc' });
  const result = await api.reconcilePost({ accountId: 'ig', caption: 'caption', scheduledAt: '2026-09-01T12:00:00Z', pageSize: 1 }); assert.deepEqual(calls, ['0', '1']); assert.equal(result.post._id, 'wanted');
});
