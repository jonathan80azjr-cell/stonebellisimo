import assert from 'node:assert/strict';
import test from 'node:test';
import { processPublishingQueue, publishingGate } from '../src/growth-publishing.mjs';

const authorizedEnv = {
  GROWTH_AUTHORIZATION_SIGNED: 'true', GROWTH_LIVE_WRITES_AUTHORIZED: 'true',
  GROWTH_REQUIRE_COMPLETE_CONTENT_BATCH: 'true',
  GROWTH_PERMITTED_ACTIONS: 'create_in_review_post,schedule_approved_post', HIGHLEVEL_PRIVATE_TOKEN: 'token', HIGHLEVEL_LOCATION_ID: 'location',
  HIGHLEVEL_PUBLISHING_USER_ID: 'user', HIGHLEVEL_APPROVER_USER_ID: 'approver', HIGHLEVEL_GBP_ACCOUNT_ID: 'google',
  HIGHLEVEL_INSTAGRAM_ACCOUNT_ID: 'instagram', HIGHLEVEL_FACEBOOK_ACCOUNT_ID: 'facebook'
};

test('publishing is blocked by default and performs no queue read', async () => {
  assert.equal(publishingGate({}, { outboundPaused: true }).ok, false);
  let listed = false;
  const result = await processPublishingQueue({}, {
    growthStore: { getControls: async () => ({ outboundPaused: true }), setHealth: async () => {}, listContent: async () => { listed = true; } }
  });
  assert.equal(listed, false);
  assert.ok(result.blocked.length);
});

test('a reconciled remote post is recorded and never created twice', async () => {
  let creates = 0; let readback;
  const content = {
    id: 'content-1', status: 'uploaded', rightsApproved: true, privacyCleared: true,
    approvalEvidence: { actor: 'Jensy' }, assets: [{ sha256: 'abc', storagePath: 'asset.jpg', mimeType: 'image/jpeg' }],
    channelPackages: { instagram: { caption: 'Quartz reveal', captionVersion: 'v1', scheduledAt: '2026-09-01T16:00:00Z', status: 'ready_for_review', approvedBy: 'Jensy', approvedAt: '2026-08-25T12:00:00Z' } }
  };
  const result = await processPublishingQueue(authorizedEnv, {
    now: Date.parse('2026-08-25T12:00:00Z'),
    growthStore: {
      getControls: async () => ({ outboundPaused: false }), listContent: async () => [content],
      getContent: async () => content,
      recordPublishingReadback: async (_id, _channel, value) => { readback = value; },
      reservePublishingAttempt: async () => assert.fail('remote match must not reserve'), setHealth: async () => {}
    },
    client: {
      reconcilePost: async () => ({ found: true, safeToCreate: false, post: { _id: 'remote-1', accountIds: ['instagram'], summary: 'Quartz reveal', scheduleDate: '2026-09-01T16:00:00Z', status: 'in_review' } }),
      createInReview: async () => { creates += 1; }
    },
    batchReadiness: () => ({ ready: true, errors: [] })
  });
  assert.equal(creates, 0);
  assert.equal(result.reconciled, 1);
  assert.equal(readback.remotePostId, 'remote-1');
});

test('an uncertain remote read never permits create', async () => {
  let creates = 0;
  const result = await processPublishingQueue(authorizedEnv, {
    now: Date.parse('2026-08-25T12:00:00Z'),
    growthStore: {
      getControls: async () => ({ outboundPaused: false }),
      listContent: async () => [{ id: 'c', status: 'uploaded', rightsApproved: true, privacyCleared: true, approvalEvidence: { actor: 'J' }, assets: [{ sha256: 'a' }], channelPackages: { facebook: { caption: 'x', scheduledAt: '2026-09-01T16:00:00Z', status: 'ready_for_review', approvedBy: 'Jonathan', approvedAt: '2026-08-25T12:00:00Z' } } }],
      getContent: async () => ({ id: 'c', status: 'uploaded', channelPackages: {} }),
      setHealth: async () => {}
    },
    client: { reconcilePost: async () => ({ found: false, safeToCreate: false }), createInReview: async () => { creates += 1; } },
    batchReadiness: () => ({ ready: true, errors: [] })
  });
  assert.equal(creates, 0);
  assert.equal(result.uncertain, 1);
});

test('a remotely approved in-review post is scheduled only through the permitted v3 update and read back', async () => {
  let scheduled = 0; let saved;
  const content = { id: 'approved-post', month: '2026-08', status: 'uploaded', rightsApproved: true, privacyCleared: true, approvalEvidence: { actor: 'Jensy' }, assets: [{ sha256: 'a' }], channelPackages: { instagram: { caption: 'Approved quartz', scheduledAt: '2026-09-01T16:00:00Z', status: 'ready_for_review', approvedBy: 'Jensy', approvedAt: '2026-08-25T12:00:00Z' } } };
  const result = await processPublishingQueue(authorizedEnv, {
    now: Date.parse('2026-08-25T12:00:00Z'), mediaResolver: async () => [{ url: 'https://example.test/a.jpg', type: 'image/jpeg' }], batchReadiness: () => ({ ready: true, errors: [] }),
    growthStore: { getControls: async () => ({ outboundPaused: false }), listContent: async () => [content], getContent: async () => ({ ...content, channelPackages: {} }), recordPublishingReadback: async (_id, _channel, value) => { saved = value; }, setHealth: async () => {} },
    client: { reconcilePost: async () => ({ found: true, safeToCreate: false, post: { _id: 'remote-approved', accountIds: ['instagram'], status: 'in_review', postApprovalDetails: { approvalStatus: 'approved' } } }), scheduleApprovedPost: async () => { scheduled += 1; return { scheduled: true, uncertainWrite: true }; }, getPost: async () => ({ status: 200, post: { _id: 'remote-approved', accountIds: ['instagram'], status: 'scheduled' } }) }
  });
  assert.equal(scheduled, 1); assert.equal(result.scheduled, 1); assert.equal(saved.uncertainWrite, false);
});

test('an L3 platform disconnect blocks that channel before any remote read', async () => {
  let reads = 0;
  const result = await processPublishingQueue(authorizedEnv, {
    now: Date.parse('2026-08-25T12:00:00Z'),
    growthStore: {
      getControls: async () => ({ outboundPaused: false, disconnectedPlatforms: ['instagram'] }),
      listContent: async () => [{
        id: 'l3-content', month: '2026-08', status: 'uploaded', rightsApproved: true, privacyCleared: true,
        approvalEvidence: { actor: 'Jensy' }, assets: [{ sha256: 'a' }],
        channelPackages: { instagram: { caption: 'Blocked', scheduledAt: '2026-09-01T16:00:00Z', status: 'ready_for_review', approvedBy: 'Jensy', approvedAt: '2026-08-25T12:00:00Z' } }
      }],
      getContent: async () => ({ id: 'l3-content', status: 'uploaded', channelPackages: {} }),
      setHealth: async () => {}
    },
    client: { reconcilePost: async () => { reads += 1; } },
    batchReadiness: () => ({ ready: true, errors: [] })
  });
  assert.equal(reads, 0);
  assert.match(result.blocked.join(' '), /L3 platform disconnect/);
});
