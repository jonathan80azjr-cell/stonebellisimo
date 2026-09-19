import { createHash } from 'node:crypto';
import { HighLevelSocialPlanner, socialPostIdempotencyKey } from './highlevel.mjs';
import { GROWTH_CLIENT } from './growth-client-config.mjs';
import { monthlyContentReadiness } from './growth-store.mjs';

const CHANNELS = Object.freeze(['instagram', 'facebook', 'google']);
const SUCCESS_REMOTE_STATES = new Set(['in_review', 'scheduled', 'published']);

function csv(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function truthy(value) {
  return ['true', '1', 'yes'].includes(String(value || '').toLowerCase());
}

function permitted(env, action) { return csv(env.GROWTH_PERMITTED_ACTIONS).includes(action); }

export function publishingGate(env = {}, controls = {}) {
  const errors = [];
  if (!truthy(env.GROWTH_AUTHORIZATION_SIGNED)) errors.push('signed authorization is missing');
  if (!truthy(env.GROWTH_LIVE_WRITES_AUTHORIZED)) errors.push('live writes are not authorized');
  if (!permitted(env, 'create_in_review_post')) errors.push('create_in_review_post is not permitted');
  if (!truthy(env.GROWTH_REQUIRE_COMPLETE_CONTENT_BATCH)) errors.push('monthly content batch enforcement is not confirmed');
  if (controls.outboundPaused !== false) errors.push('L1 outbound pause is active');
  if (!env.HIGHLEVEL_PRIVATE_TOKEN) errors.push('HighLevel token is missing');
  if (!env.HIGHLEVEL_LOCATION_ID) errors.push('HighLevel location ID is missing');
  if (!env.HIGHLEVEL_PUBLISHING_USER_ID) errors.push('HighLevel publishing user ID is missing');
  if (!env.HIGHLEVEL_APPROVER_USER_ID) errors.push('HighLevel approver ID is missing');
  for (const [channel, name] of Object.entries({
    google: 'HIGHLEVEL_GBP_ACCOUNT_ID',
    instagram: 'HIGHLEVEL_INSTAGRAM_ACCOUNT_ID',
    facebook: 'HIGHLEVEL_FACEBOOK_ACCOUNT_ID'
  })) {
    if (!env[name]) errors.push(`${channel} Social Planner account ID is missing`);
  }
  return { ok: errors.length === 0, errors };
}

function accountMap(env) {
  return {
    google: env.HIGHLEVEL_GBP_ACCOUNT_ID,
    instagram: env.HIGHLEVEL_INSTAGRAM_ACCOUNT_ID,
    facebook: env.HIGHLEVEL_FACEBOOK_ACCOUNT_ID
  };
}

function remoteId(post) {
  return post?._id || post?.id || '';
}

function postAccounts(post) {
  return Array.isArray(post?.accountIds) ? post.accountIds : [];
}

function validReadback(post, accountId) {
  return Boolean(remoteId(post) && postAccounts(post).includes(accountId) && SUCCESS_REMOTE_STATES.has(post.status));
}

function remoteApprovalIsGranted(post) {
  return post?.status === 'in_review' && post?.postApprovalDetails?.approvalStatus === 'approved';
}

function sourceHash(content) {
  const hashes = (content.assets || []).map(asset => asset.sha256).filter(Boolean).sort();
  if (!hashes.length) throw new Error('Content assets have no source hashes.');
  return createHash('sha256').update(hashes.join('|')).digest('hex');
}

async function defaultMediaResolver(bucket, content) {
  if (!bucket) throw new Error('Firebase Storage is not configured.');
  return Promise.all((content.assets || []).map(async asset => {
    const [url] = await bucket.file(asset.storagePath).getSignedUrl({ action: 'read', expires: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    return { url, type: asset.mimeType, altText: `${content.material || 'Stone'} ${content.projectType || 'project'} in ${content.city || 'New Jersey'}` };
  }));
}

function attemptedInLastDay(content, now) {
  return Object.values(content.channelPackages || {}).filter(channelPackage => {
    const attemptedAt = new Date(channelPackage.createAttemptedAt || 0).getTime();
    return attemptedAt && now - attemptedAt < 24 * 60 * 60 * 1000;
  }).length;
}

async function reconcileExisting({ store, client, content, channel, channelPackage, accountId }) {
  if (channelPackage.remotePostId) {
    const read = await client.getPost(channelPackage.remotePostId);
    if (read.status >= 200 && read.status < 300 && validReadback(read.post, accountId)) {
      await store.recordPublishingReadback(content.id, channel, {
        remotePostId: remoteId(read.post), remoteAccountId: accountId, remoteStatus: read.post.status,
        status: read.post.status, uncertainWrite: false, remoteReadAt: new Date().toISOString()
      });
      return { resolved: true, found: true, post: read.post };
    }
    return { resolved: false, found: false };
  }
  const reconciliation = await client.reconcilePost({
    accountId,
    caption: channelPackage.caption,
    scheduledAt: channelPackage.scheduledAt,
    postType: channelPackage.postType || 'post'
  });
  if (reconciliation.found && validReadback(reconciliation.post, accountId)) {
    await store.recordPublishingReadback(content.id, channel, {
      remotePostId: remoteId(reconciliation.post), remoteAccountId: accountId, remoteStatus: reconciliation.post.status,
      status: reconciliation.post.status, uncertainWrite: false, remoteReadAt: new Date().toISOString()
    });
    return { resolved: true, found: true, post: reconciliation.post };
  }
  return { resolved: reconciliation.safeToCreate === true, found: false, remoteAbsenceProven: reconciliation.safeToCreate === true };
}

export async function processPublishingQueue(env, {
  growthStore,
  bucket = null,
  client = null,
  fetch: fetchImpl = globalThis.fetch,
  mediaResolver = defaultMediaResolver,
  batchReadiness = monthlyContentReadiness,
  now = Date.now()
} = {}) {
  if (!growthStore) throw new Error('Growth automation store is required.');
  const controls = await growthStore.getControls();
  const gate = publishingGate(env, controls);
  if (!gate.ok) {
    await growthStore.setHealth('publishing', { status: 'blocked', message: gate.errors.join('; ') });
    return { checked: 0, created: 0, reconciled: 0, uncertain: 0, blocked: gate.errors };
  }

  const planner = client || new HighLevelSocialPlanner({
    fetch: fetchImpl,
    accessToken: env.HIGHLEVEL_PRIVATE_TOKEN,
    locationId: env.HIGHLEVEL_LOCATION_ID,
    userId: env.HIGHLEVEL_PUBLISHING_USER_ID,
    approverId: env.HIGHLEVEL_APPROVER_USER_ID
  });
  const configuredAccounts = accountMap(env);
  const disconnectedPlatforms = new Set(controls.disconnectedPlatforms || []);
  const contentRows = await growthStore.listContent({ limit: 250 });
  const batchByMonth = new Map();
  for (const item of contentRows) {
    if (!batchByMonth.has(item.month)) {
      batchByMonth.set(item.month, batchReadiness(contentRows.filter(candidate => candidate.month === item.month)));
    }
  }
  let remainingCreates = Math.max(0, GROWTH_CLIENT.publishing.client_ceiling_per_24h - contentRows.reduce((sum, content) => sum + attemptedInLastDay(content, now), 0));
  const summary = { checked: 0, created: 0, scheduled: 0, reconciled: 0, uncertain: 0, blocked: [] };

  for (const content of contentRows.filter(item => ['uploaded', 'scheduled'].includes(item.status))) {
    const batch = batchByMonth.get(content.month);
    if (!batch?.ready) {
      summary.blocked.push(`${content.month || 'unknown month'}: ${(batch?.errors || ['monthly content batch is incomplete']).join(' ')}`);
      continue;
    }
    if (!content.approvalEvidence?.actor || content.rightsApproved !== true || content.privacyCleared !== true) {
      summary.blocked.push(`${content.id}: approval evidence missing`);
      continue;
    }
    if (content.includesOffer && (!content.offerApproved || !content.offerExpiresAt || new Date(content.offerExpiresAt).getTime() <= now)) {
      summary.blocked.push(`${content.id}: offer expired or unapproved`);
      continue;
    }
    for (const channel of CHANNELS) {
      const channelPackage = content.channelPackages?.[channel];
      if (!channelPackage?.caption || !channelPackage?.scheduledAt) continue;
      if (disconnectedPlatforms.has(channel)) {
        summary.blocked.push(`${content.id}/${channel}: L3 platform disconnect is active`);
        continue;
      }
      if (!channelPackage.approvedBy || !channelPackage.approvedAt || channelPackage.status !== 'ready_for_review') {
        summary.blocked.push(`${content.id}/${channel}: channel approval missing`);
        continue;
      }
      summary.checked += 1;
      const accountId = configuredAccounts[channel];
      if (channelPackage.remoteAccountId && channelPackage.remoteAccountId !== accountId) {
        summary.blocked.push(`${content.id}/${channel}: wrong account ledger`);
        continue;
      }
      const scheduledAt = new Date(channelPackage.scheduledAt);
      const leadMinutes = GROWTH_CLIENT.publishing.min_lead_time_minutes;
      if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < now + leadMinutes * 60 * 1000) {
        summary.blocked.push(`${content.id}/${channel}: schedule violates ${leadMinutes}-minute lead time`);
        continue;
      }

      const reconciliation = await reconcileExisting({ store: growthStore, client: planner, content, channel, channelPackage, accountId });
      if (reconciliation.found) {
        if (remoteApprovalIsGranted(reconciliation.post)) {
          if (!permitted(env, 'schedule_approved_post')) {
            summary.blocked.push(`${content.id}/${channel}: schedule_approved_post is not permitted`);
            continue;
          }
          const media = await mediaResolver(bucket, content);
          const scheduled = await planner.scheduleApprovedPost({
            postId: remoteId(reconciliation.post), accountId, caption: channelPackage.caption, media,
            scheduledAt: scheduledAt.toISOString(), type: channelPackage.postType || 'post',
            ...(channel === 'google' && channelPackage.trackedUrl ? { gmbPostDetails: { gmbEventType: 'STANDARD', actionType: channelPackage.actionType || 'LEARN_MORE', url: channelPackage.trackedUrl } } : {})
          });
          const scheduledRead = await planner.getPost(remoteId(reconciliation.post));
          if (scheduledRead.status >= 200 && scheduledRead.status < 300 && validReadback(scheduledRead.post, accountId) && ['scheduled', 'published'].includes(scheduledRead.post.status)) {
            await growthStore.recordPublishingReadback(content.id, channel, {
              remotePostId: remoteId(scheduledRead.post), remoteAccountId: accountId, remoteStatus: scheduledRead.post.status,
              status: scheduledRead.post.status, uncertainWrite: false, remoteReadAt: new Date().toISOString()
            });
            summary.scheduled += 1;
          } else {
            await growthStore.recordPublishingReadback(content.id, channel, {
              remotePostId: remoteId(reconciliation.post), remoteAccountId: accountId, remoteStatus: '', status: 'uncertain', uncertainWrite: true
            });
            summary.uncertain += 1;
          }
          continue;
        }
        summary.reconciled += 1;
        continue;
      }
      if (!reconciliation.remoteAbsenceProven) {
        summary.uncertain += 1;
        continue;
      }
      if (remainingCreates <= 0) {
        summary.blocked.push('client publishing ceiling reached');
        break;
      }

      const hash = sourceHash(content);
      const idempotencyKey = socialPostIdempotencyKey({
        sourceHash: hash,
        accountId,
        caption: channelPackage.caption,
        captionVersion: channelPackage.captionVersion || 'v1',
        scheduledAt: scheduledAt.toISOString()
      });
      const reservation = await growthStore.reservePublishingAttempt(content.id, channel, { idempotencyKey, remoteAbsenceProven: true });
      if (reservation.action !== 'create') continue;
      remainingCreates -= 1;
      const media = await mediaResolver(bucket, content);
      const created = await planner.createInReview({
        accountId,
        caption: channelPackage.caption,
        media,
        scheduledAt: scheduledAt.toISOString(),
        sourceHash: hash,
        captionVersion: channelPackage.captionVersion || 'v1',
        type: channelPackage.postType || 'post',
        ...(channel === 'google' && channelPackage.trackedUrl ? { gmbPostDetails: { gmbEventType: 'STANDARD', actionType: channelPackage.actionType || 'LEARN_MORE', url: channelPackage.trackedUrl } } : {})
      });
      const postId = remoteId(created.post);
      if (!postId) {
        await growthStore.recordPublishingReadback(content.id, channel, {
          remoteAccountId: accountId, remoteStatus: '', status: 'uncertain', uncertainWrite: true
        });
        summary.uncertain += 1;
        continue;
      }
      const read = await planner.getPost(postId);
      if (read.status >= 200 && read.status < 300 && validReadback(read.post, accountId)) {
        await growthStore.recordPublishingReadback(content.id, channel, {
          remotePostId: postId, remoteAccountId: accountId, remoteStatus: read.post.status,
          status: read.post.status, uncertainWrite: false, remoteReadAt: new Date().toISOString()
        });
        summary.created += 1;
      } else {
        await growthStore.recordPublishingReadback(content.id, channel, {
          remotePostId: postId, remoteAccountId: accountId, remoteStatus: '', status: 'uncertain', uncertainWrite: true
        });
        summary.uncertain += 1;
      }
    }
    const refreshed = await growthStore.getContent(content.id);
    const packages = CHANNELS.map(channel => refreshed?.channelPackages?.[channel]);
    if (packages.every(channelPackage => channelPackage && ['scheduled', 'published'].includes(channelPackage.remoteStatus)) && refreshed.status === 'uploaded') {
      await growthStore.transitionContent(content.id, 'scheduled', 'highlevel-readback', { note: 'All channel posts verified scheduled remotely.' });
    }
    if (packages.every(channelPackage => channelPackage?.remoteStatus === 'published') && refreshed.status === 'scheduled') {
      await growthStore.transitionContent(content.id, 'published', 'highlevel-readback', { note: 'All channel posts verified published remotely.' });
    }
  }
  await growthStore.setHealth('publishing', {
    status: summary.uncertain || summary.blocked.length ? 'attention' : 'healthy',
    message: `Checked ${summary.checked}; created ${summary.created}; scheduled ${summary.scheduled}; reconciled ${summary.reconciled}; uncertain ${summary.uncertain}.`,
    lastSuccessAt: new Date(now).toISOString()
  });
  return summary;
}
